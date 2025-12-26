from flask import Blueprint, request, render_template, jsonify, Response, session
from flask_socketio import emit
import requests
import os
import threading
import time
import json
import mimetypes
from urllib.parse import urlparse, parse_qs, unquote
import uuid
from datetime import datetime
import sqlite3
from concurrent.futures import ThreadPoolExecutor
import re
import psutil 

# --- GOOGLE DRIVE IMPORTS ---
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# Define Blueprint
curl_bp = Blueprint('curl', __name__)

# Global variables
active_downloads = {}
download_history = [] 
download_executor = ThreadPoolExecutor(max_workers=10)
SCOPES = ['https://www.googleapis.com/auth/drive.file']

# --- DATABASE INIT ---
def init_db():
    conn = sqlite3.connect('downloads.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS downloads
                 (id TEXT PRIMARY KEY, filename TEXT, url TEXT, 
                  total_size INTEGER, downloaded_size INTEGER, 
                  status TEXT, created_at TIMESTAMP)''')
    conn.commit()
    conn.close()

init_db()

# --- GOOGLE DRIVE UTILITIES ---
def get_gdrive_service():
    creds = None
    token_path = 'token.json'
    
    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception as e:
            print(f"Error loading token.json: {e}")
            return None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # Save the refreshed credentials back to token.json
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
            except Exception as e:
                print(f"Error refreshing token: {e}")
                return None
        else:
            print("No valid token.json found. Please generate one locally.")
            return None

    return build('drive', 'v3', credentials=creds)

def upload_file_to_drive(filepath, filename):
    service = get_gdrive_service()
    if not service:
        return None
    
    try:
        file_metadata = {'name': filename}
        media = MediaFileUpload(filepath, resumable=True)
        
        # Upload the file
        file = service.files().create(
            body=file_metadata, 
            media_body=media, 
            fields='id, webViewLink, webContentLink'
        ).execute()
        
        # Permission handling: Make it readable by anyone with the link (Optional, removes need for login to view)
        # remove the next 3 lines if you want the file private
        service.permissions().create(
            fileId=file.get('id'),
            body={'type': 'anyone', 'role': 'reader'}
        ).execute()

        return file
    except Exception as e:
        print(f"GDrive Upload Error: {e}")
        return None

# --- UTILITIES ---

def extract_filename_from_url(url):
    try:
        parsed_url = urlparse(url)
        path = parsed_url.path
        filename = os.path.basename(unquote(path))
        if not filename or filename == '/':
            query_params = parse_qs(parsed_url.query)
            if 'filename' in query_params:
                filename = query_params['filename'][0]
            elif 'file' in query_params:
                filename = query_params['file'][0]
        if filename:
            filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
            if '.' not in filename:
                filename += '.download'
        else:
            filename = 'download_file'
        return filename
    except Exception as e:
        print(f"Error extracting filename from URL: {e}")
        return 'download_file'

def extract_filename_from_headers(response_headers):
    try:
        content_disposition = response_headers.get('content-disposition', '')
        if content_disposition:
            filename_match = re.search(r'filename[*]?=([^;]+)', content_disposition)
            if filename_match:
                filename = filename_match.group(1).strip('\"\' ')
                filename = unquote(filename)
                if filename.startswith("UTF-8''"):
                    filename = filename[7:]
                    filename = unquote(filename)
                filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
                return filename
    except Exception as e:
        print(f"Error extracting filename from headers: {e}")
    return None

def get_smart_filename(url, response_headers=None, custom_filename=None):
    if custom_filename and custom_filename.strip():
        custom_filename = custom_filename.strip()
        custom_filename = re.sub(r'[<>:"/\\|?*]', '_', custom_filename)
        return custom_filename

    if response_headers:
        header_filename = extract_filename_from_headers(response_headers)
        if header_filename:
            return header_filename

    url_filename = extract_filename_from_url(url)
    if url_filename and url_filename != 'download_file':
        return url_filename

    try:
        domain = urlparse(url).netloc
        domain = re.sub(r'[<>:"/\\|?*]', '_', domain)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{domain}_{timestamp}.download"
    except:
        return f"download_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

def convert_gdrive_url(share_url):
    file_id = None
    try:
        if '/file/d/' in share_url:
            file_id = share_url.split('/file/d/')[1].split('/')[0]
        elif 'id=' in share_url:
            file_id = parse_qs(urlparse(share_url).query)['id'][0]
        
        if file_id:
            direct_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            return direct_url, None
            
    except Exception as e:
        print(f"GDrive conversion error: {e}")
    return share_url, None

# --- BLUEPRINT ROUTES ---

@curl_bp.route("/", methods=["GET"])
def index():
    return render_template('curl.html')

@curl_bp.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"}), 200

@curl_bp.route("/detect_filename", methods=["POST"])
def detect_filename_route():
    data = request.get_json()
    url = data.get('url', '')
    if not url: return jsonify({'success': False})
    
    try:
        head = requests.head(url, timeout=5, allow_redirects=True)
        name = extract_filename_from_headers(head.headers)
        if not name: name = extract_filename_from_url(url)
        return jsonify({'success': True, 'filename': name, 'source': 'detected'})
    except Exception as e:
        return jsonify({'success': True, 'filename': get_smart_filename(url), 'source': 'fallback'})

@curl_bp.route("/convert_gdrive_url", methods=["POST"])
def convert_gdrive_url_route():
    data = request.get_json()
    url = data.get('url', '')
    direct_url, filename = convert_gdrive_url(url)
    if direct_url and direct_url != url:
        return jsonify({'success': True, 'direct_url': direct_url, 'filename': filename})
    return jsonify({'success': False})

@curl_bp.route("/list_files", methods=["GET"])
def list_files_route():
    return jsonify({'files': list(reversed(download_history))})

@curl_bp.route("/delete_file", methods=["POST"])
def delete_file_route():
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename or '..' in filename or '/' in filename or '\\' in filename:
        return jsonify({'success': False, 'error': 'Invalid filename'})
    
    path = os.path.join("downloads", filename)
    global download_history
    download_history = [f for f in download_history if f['name'] != filename]
    
    try:
        if os.path.exists(path):
            os.remove(path)
            return jsonify({'success': True})
        else:
            return jsonify({'success': True, 'message': 'Removed from history (file was missing)'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@curl_bp.route('/stream/<path:filename>')
def stream_file(filename):
    file_path = os.path.join("downloads", filename)
    if not os.path.exists(file_path):
        return "File not found", 404

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get('Range', None)
    
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type: mime_type = 'application/octet-stream'

    byte1, byte2 = 0, None
    if range_header:
        m = re.search(r'(\d+)-(\d*)', range_header)
        g = m.groups()
        if g[0]: byte1 = int(g[0])
        if g[1]: byte2 = int(g[1])

    length = file_size - byte1
    if byte2 is not None:
        length = byte2 + 1 - byte1

    def generate():
        with open(file_path, 'rb') as f:
            f.seek(byte1)
            remaining = length
            chunk_size = 1024 * 1024 
            while remaining > 0:
                read_amount = min(remaining, chunk_size)
                data = f.read(read_amount)
                if not data: break
                yield data 
                remaining -= len(data)

    rv = Response(generate(), 206, mimetype=mime_type, direct_passthrough=True)
    rv.headers.add('Content-Range', 'bytes {0}-{1}/{2}'.format(byte1, byte1 + length - 1, file_size))
    rv.headers.add('Accept-Ranges', 'bytes')
    return rv

# --- CONTROLLER CLASS ---

class DownloadController:
    def __init__(self, download_id, url, filename_mode='original', custom_filename=None):
        self.download_id = download_id
        self.url = url
        self.filename_mode = filename_mode
        self.custom_filename = custom_filename
        self.final_filename = None
        self.is_paused = False
        self.is_cancelled = False
        self.active_run_id = str(uuid.uuid4())
        self.session = requests.Session()
        self.last_status = None 
        
        adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=3)
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Connection': 'keep-alive'
        })

    def determine_filename(self, response_headers=None):
        if self.final_filename: return self.final_filename
        
        if self.filename_mode == 'custom' and self.custom_filename:
            self.final_filename = self.custom_filename.strip()
            self.final_filename = re.sub(r'[<>:"/\\|?*]', '_', self.final_filename)
        else:
            self.final_filename = get_smart_filename(self.url, response_headers)
        return self.final_filename

# --- SOCKET & BACKGROUND TASK LOGIC ---

def background_system_stats(socketio_instance):
    while True:
        try:
            memory = psutil.virtual_memory()
            stats = {
                "ram": memory.percent,
                "ram_used": round(memory.used / (1024 * 1024), 1),
                "ram_total": round(memory.total / (1024 * 1024), 1)
            }
            socketio_instance.emit('server_stats', stats)
            socketio_instance.sleep(2)
        except Exception as e:
            print(f"Stats Error: {e}")
            socketio_instance.sleep(5)

def download_with_smart_filename(controller, socketio_instance):
    download_id = controller.download_id
    url = controller.url
    current_run_id = controller.active_run_id
    
    try:
        if not controller.final_filename:
            try:
                head = controller.session.head(url, timeout=10, allow_redirects=True)
                controller.determine_filename(head.headers)
            except Exception:
                controller.determine_filename()
        
        filename = controller.final_filename
        os.makedirs("downloads", exist_ok=True)
        filepath = os.path.join("downloads", filename)

        if controller.is_cancelled:
            if os.path.exists(filepath): os.remove(filepath)
            return

        resume_byte_pos = os.path.getsize(filepath) if os.path.exists(filepath) else 0

        headers = {}
        if resume_byte_pos > 0:
            headers["Range"] = f"bytes={resume_byte_pos}-"

        with controller.session.get(url, headers=headers, stream=True, timeout=20) as response:
            response.raise_for_status()

            if response.status_code == 206:
                file_mode = "ab"
                downloaded = resume_byte_pos
            else:
                file_mode = "wb"
                downloaded = 0
                resume_byte_pos = 0

            if "content-range" in response.headers:
                total_size = int(response.headers["content-range"].split("/")[-1])
            else:
                content_length = int(response.headers.get("content-length", 0))
                if resume_byte_pos > 0 and response.status_code == 206:
                    total_size = content_length + resume_byte_pos
                else:
                    total_size = content_length

            with open(filepath, file_mode, buffering=1024*1024) as f:
                start_time = time.time()
                last_emit = 0

                for chunk in response.iter_content(chunk_size=1024*1024):
                    if controller.is_cancelled:
                        break 
                    if controller.is_paused or controller.active_run_id != current_run_id:
                        return

                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        if now - last_emit >= 0.5:
                            elapsed = max(now - start_time, 0.1)
                            speed = (downloaded - resume_byte_pos) / elapsed
                            pct = (downloaded / total_size * 100) if total_size else 0
                            
                            remaining = max(total_size - downloaded, 0)
                            if speed > 0 and remaining > 0:
                                eta_s = remaining / speed
                                eta_str = f"{int(eta_s // 60)}m {int(eta_s % 60)}s"
                            else:
                                eta_str = "--"

                            status_payload = {
                                "download_id": download_id,
                                "filename": filename,
                                "percentage": pct,
                                "speed": format_speed(speed),
                                "eta": eta_str,
                                "downloaded": downloaded,
                                "total_size": total_size
                            }
                            controller.last_status = status_payload
                            socketio_instance.emit("download_progress", status_payload)
                            last_emit = now

        if controller.is_cancelled:
            try:
                if os.path.exists(filepath): os.remove(filepath)
            except: pass
            active_downloads.pop(download_id, None)
            return 

        # --- UPLOAD TO DRIVE LOGIC ---
        if not controller.is_paused and controller.active_run_id == current_run_id:
            
            # 1. Notify UI that we are uploading
            upload_status = {
                "download_id": download_id,
                "filename": filename,
                "percentage": 100,
                "speed": "Uploading...",
                "eta": "GDrive",
                "downloaded": total_size,
                "total_size": total_size
            }
            socketio_instance.emit("download_progress", upload_status)

            # 2. Perform Upload
            gdrive_file = None
            try:
                gdrive_file = upload_file_to_drive(filepath, filename)
            except Exception as e:
                print(f"Upload failed: {e}")

            # 3. Add to history
            file_entry = {
                'name': filename,
                'size': total_size,
                'date': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'gdrive_link': gdrive_file.get('webViewLink') if gdrive_file else None,
                'gdrive_id': gdrive_file.get('id') if gdrive_file else None
            }
            download_history.append(file_entry)
            
            # 4. Complete
            socketio_instance.emit("download_complete", {
                "download_id": download_id,
                "filename": filename
            })
            active_downloads.pop(download_id, None)

    except Exception as e:
        if not controller.is_paused and not controller.is_cancelled and controller.active_run_id == current_run_id:
            socketio_instance.emit("download_error", {
                "download_id": download_id,
                "error": str(e)
            })

def format_speed(speed):
    if speed < 1024: return f"{speed:.1f} B/s"
    elif speed < 1024**2: return f"{speed/1024:.1f} KB/s"
    else: return f"{speed/1024**2:.1f} MB/s"

# --- REGISTER SOCKET EVENTS (Called by app.py) ---
def register_socket_events(socketio):
    socketio.start_background_task(background_system_stats, socketio)

    @socketio.on('connect')
    def handle_connect():
        if active_downloads:
            for download_id, controller in active_downloads.items():
                if controller.is_cancelled:
                    continue
                if controller.last_status:
                    emit('download_progress', controller.last_status)
                elif controller.is_paused:
                    emit('download_paused', {'download_id': download_id})

    @socketio.on('start_download')
    def handle_start_download(data):
        download_id = str(uuid.uuid4())
        controller = DownloadController(download_id, data['url'], data.get('filename_mode'), data.get('custom_filename'))
        active_downloads[download_id] = controller
        
        # Use background task for Render/Eventlet compatibility
        socketio.start_background_task(download_with_smart_filename, controller, socketio)
        
        initial_status = {
            'download_id': download_id,
            'filename': 'Starting...',
            'percentage': 0,
            'speed': '0 B/s',
            'eta': '--',
            'downloaded': 0,
            'total_size': 0
        }
        controller.last_status = initial_status
        emit('download_progress', initial_status)

    @socketio.on('pause_download')
    def handle_pause(data):
        did = data['download_id']
        if did in active_downloads:
            controller = active_downloads[did]
            controller.is_paused = True
            controller.active_run_id = str(uuid.uuid4())
            emit('download_paused', {'download_id': did})

    @socketio.on('resume_download')
    def handle_resume(data):
        did = data['download_id']
        if did in active_downloads:
            controller = active_downloads[did]
            if controller.is_paused:
                controller.is_paused = False
                controller.active_run_id = str(uuid.uuid4())
                socketio.start_background_task(download_with_smart_filename, controller, socketio)

    @socketio.on('cancel_download')
    def handle_cancel(data):
        did = data['download_id']
        controller = active_downloads.get(did)
        if controller:
            controller.is_cancelled = True
            active_downloads.pop(did, None)
            if controller.is_paused:
                try:
                    if controller.final_filename:
                        filepath = os.path.join("downloads", controller.final_filename)
                        if os.path.exists(filepath):
                            os.remove(filepath)
                except Exception as e:
                    print(f"Error deleting paused file: {e}")
