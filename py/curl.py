from flask import Blueprint, request, render_template, jsonify, Response, stream_with_context
from flask_socketio import emit
import requests
import os
import uuid
import time
import re
import mimetypes
import psutil 
import io
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, unquote, parse_qs

# --- GOOGLE DRIVE IMPORTS ---
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

curl_bp = Blueprint('curl', __name__)

# --- CONFIG & GLOBALS ---
active_downloads = {}
download_history = [] 
SCOPES = ['https://www.googleapis.com/auth/drive'] # Full drive scope for streaming
TOKEN_PATH = 'token.json'

# --- GOOGLE DRIVE UTILITIES ---

def get_credentials():
    """Gets valid user credentials from storage."""
    creds = None
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        except Exception as e:
            print(f"Token Error: {e}")
            return None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(TOKEN_PATH, 'w') as token:
                    token.write(creds.to_json())
            except Exception as e:
                print(f"Refresh Error: {e}")
                return None
        else:
            print("No valid token.json found.")
            return None
    return creds

def get_gdrive_service():
    """Builds the Drive Service."""
    creds = get_credentials()
    if not creds: return None
    return build('drive', 'v3', credentials=creds)

def get_file_metadata(file_id):
    """Fetches name and mimeType from Drive."""
    try:
        service = get_gdrive_service()
        if not service: return {"name": "Unknown"}
        file = service.files().get(fileId=file_id, fields="name, mimeType, size").execute()
        return file
    except Exception as e:
        print(f"Metadata Error: {e}")
        return {"name": "Unknown"}

def srt_to_vtt(srt_content):
    """Converts SRT content to WebVTT format for browser player."""
    try:
        text = srt_content.decode('utf-8', errors='ignore').replace('\r\n', '\n')
        text = re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', text)
        return "WEBVTT\n\n" + text
    except Exception as e:
        print(f"Conversion Error: {e}")
        return "WEBVTT\n\n"

def upload_file_to_drive(filepath, filename):
    """Uploads file and returns the Google Drive File Object."""
    service = get_gdrive_service()
    if not service: return None
    
    try:
        file_metadata = {'name': filename}
        media = MediaFileUpload(filepath, resumable=True)
        
        # Request 'id' specifically
        file = service.files().create(
            body=file_metadata, 
            media_body=media, 
            fields='id, webViewLink, webContentLink'
        ).execute()
        
        # Make reader accessible (optional, good for direct links)
        try:
            service.permissions().create(
                fileId=file.get('id'),
                body={'type': 'anyone', 'role': 'reader'}
            ).execute()
        except: pass

        return file
    except Exception as e:
        print(f"GDrive Upload Error: {e}")
        return None

# --- LOCAL FILE UTILITIES ---

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
        print(f"Header Filename Error: {e}")
    return None

def extract_filename_from_url(url):
    try:
        parsed = urlparse(url)
        path = parsed.path
        filename = os.path.basename(unquote(path))
        if not filename or filename == '/':
            query = parse_qs(parsed.query)
            if 'filename' in query: filename = query['filename'][0]
            elif 'file' in query: filename = query['file'][0]
        
        if filename:
            filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
            if '.' not in filename: filename += '.download'
        else:
            filename = 'download_file'
        return filename
    except:
        return 'download_file'

def get_smart_filename(url, response_headers=None, custom=None):
    if custom and custom.strip():
        return re.sub(r'[<>:"/\\|?*]', '_', custom.strip())
    
    if response_headers:
        name = extract_filename_from_headers(response_headers)
        if name: return name

    name = extract_filename_from_url(url)
    if name != 'download_file': return name

    return f"download_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

def format_speed(speed):
    if speed < 1024: return f"{speed:.1f} B/s"
    elif speed < 1024**2: return f"{speed/1024:.1f} KB/s"
    else: return f"{speed/1024**2:.1f} MB/s"

def format_time(seconds):
    """Formats seconds into HH:MM:SS or MM:SS."""
    if not seconds or seconds < 0: return "--"
    try:
        m, s = divmod(int(seconds), 60)
        h, m = divmod(m, 60)
        if h > 0:
            return f"{h:02d}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"
    except:
        return "--"

# --- BLUEPRINT ROUTES ---

@curl_bp.route("/", methods=["GET"])
def index():
    return render_template('curl.html')

@curl_bp.route("/detect_filename", methods=["POST"])
def detect_filename_route():
    data = request.get_json()
    url = data.get('url', '')
    if not url: return jsonify({'success': False})
    try:
        head = requests.head(url, timeout=5, allow_redirects=True)
        name = extract_filename_from_headers(head.headers)
        if not name: name = extract_filename_from_url(url)
        return jsonify({'success': True, 'filename': name})
    except:
        return jsonify({'success': True, 'filename': get_smart_filename(url)})

@curl_bp.route("/list_files", methods=["GET"])
def list_files_route():
    return jsonify({'files': list(reversed(download_history))})

@curl_bp.route("/delete_file", methods=["POST"])
def delete_file_route():
    data = request.get_json()
    filename = data.get('filename')
    global download_history
    
    # Remove from history
    download_history = [f for f in download_history if f['name'] != filename]
    
    # Remove from local disk if exists
    try:
        path = os.path.join("downloads", filename)
        if os.path.exists(path): os.remove(path)
    except: pass
    
    return jsonify({'success': True})

# --- STREAMING ROUTES (KEY LOGIC) ---

@curl_bp.route('/stream_drive/<file_id>')
def stream_drive(file_id):
    """
    Streams media directly from Google Drive API using test.py logic.
    Handles Auth, Range Headers, and Subtitle Conversion.
    """
    creds = get_credentials()
    if not creds:
        return "Credentials invalid or missing token.json", 401

    # 1. Get Metadata
    meta = get_file_metadata(file_id)
    filename = meta.get('name', '').lower()
    
    # 2. Build Request
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    headers = {"Authorization": f"Bearer {creds.token}"}
    
    # Forward Range header for seeking
    range_header = request.headers.get('Range', None)
    if range_header:
        headers['Range'] = range_header

    req = requests.get(url, headers=headers, stream=True)
    
    # 3. Handle Subtitle Conversion (SRT -> VTT)
    if filename.endswith('.srt'):
        content = req.content 
        vtt_content = srt_to_vtt(content)
        return Response(vtt_content, content_type="text/vtt")
    
    # 4. Standard Stream
    content_type = req.headers.get("Content-Type")
    # Fix Content-Type for VTT if Drive reports incorrectly
    if filename.endswith('.vtt'):
        content_type = "text/vtt"
    
    # Clean headers for Flask response
    excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'authorization']
    response_headers = [(name, value) for (name, value) in req.headers.items()
                        if name.lower() not in excluded_headers]

    return Response(
        stream_with_context(req.iter_content(chunk_size=1024 * 64)),
        status=req.status_code,
        headers=response_headers,
        content_type=content_type
    )

@curl_bp.route('/stream/<path:filename>')
def stream_file(filename):
    """Streams local files."""
    file_path = os.path.join("downloads", filename)
    if not os.path.exists(file_path):
        return "File not found", 404

    range_header = request.headers.get('Range', None)
    file_size = os.path.getsize(file_path)
    
    byte1, byte2 = 0, None
    if range_header:
        m = re.search(r'(\d+)-(\d*)', range_header)
        g = m.groups()
        if g[0]: byte1 = int(g[0])
        if g[1]: byte2 = int(g[1])

    length = file_size - byte1
    if byte2 is not None: length = byte2 + 1 - byte1

    def generate():
        with open(file_path, 'rb') as f:
            f.seek(byte1)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64*1024, remaining))
                if not chunk: break
                yield chunk
                remaining -= len(chunk)

    rv = Response(generate(), 206, mimetype=mimetypes.guess_type(file_path)[0], direct_passthrough=True)
    rv.headers.add('Content-Range', f'bytes {byte1}-{byte1+length-1}/{file_size}')
    return rv

# --- CONTROLLER & WORKER ---

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
        self.session.headers.update({'User-Agent': 'Mozilla/5.0'})

    def determine_filename(self, response_headers=None):
        if self.final_filename: return self.final_filename
        self.final_filename = get_smart_filename(self.url, response_headers, self.custom_filename)
        return self.final_filename

def download_with_smart_filename(controller, socketio_instance):
    download_id = controller.download_id
    url = controller.url
    current_run_id = controller.active_run_id
    
    try:
        # Determine filename if not set
        if not controller.final_filename:
            try:
                head = controller.session.head(url, timeout=10, allow_redirects=True)
                controller.determine_filename(head.headers)
            except:
                controller.determine_filename()
        
        filename = controller.final_filename
        os.makedirs("downloads", exist_ok=True)
        filepath = os.path.join("downloads", filename)

        if controller.is_cancelled: return

        # Resume logic
        resume_byte_pos = os.path.getsize(filepath) if os.path.exists(filepath) else 0
        headers = {}
        if resume_byte_pos > 0: headers["Range"] = f"bytes={resume_byte_pos}-"

        # --- DOWNLOAD PHASE ---
        with controller.session.get(url, headers=headers, stream=True, timeout=20) as response:
            response.raise_for_status()
            
            file_mode = "ab" if response.status_code == 206 else "wb"
            if response.status_code != 206: resume_byte_pos = 0
            
            total_size = int(response.headers.get('content-length', 0)) + resume_byte_pos
            downloaded = resume_byte_pos

            with open(filepath, file_mode, buffering=1024*1024) as f:
                start_time = time.time()
                last_emit = 0
                
                for chunk in response.iter_content(chunk_size=1024*1024):
                    if controller.is_cancelled: break
                    if controller.is_paused or controller.active_run_id != current_run_id: return

                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.time()
                        
                        if now - last_emit >= 0.5:
                            speed = (downloaded - resume_byte_pos) / max(now - start_time, 0.1)
                            pct = (downloaded / total_size * 100) if total_size else 0
                            
                            # Calculate ETA
                            remaining_bytes = total_size - downloaded
                            eta_seconds = remaining_bytes / speed if speed > 0 else 0
                            eta_str = format_time(eta_seconds)
                            
                            status = {
                                "download_id": download_id,
                                "filename": filename,
                                "percentage": pct,
                                "speed": format_speed(speed),
                                "eta": eta_str,
                                "downloaded": downloaded,
                                "total_size": total_size
                            }
                            controller.last_status = status
                            socketio_instance.emit("download_progress", status)
                            last_emit = now

        if controller.is_cancelled:
            if os.path.exists(filepath): os.remove(filepath)
            active_downloads.pop(download_id, None)
            return

        # --- UPLOAD PHASE (The request requirement) ---
        if not controller.is_paused and controller.active_run_id == current_run_id:
            
            socketio_instance.emit("download_progress", {
                "download_id": download_id,
                "filename": filename,
                "percentage": 100,
                "speed": "Uploading to Google Drive...",
                "eta": "Processing",
                "downloaded": total_size,
                "total_size": total_size
            })

            try:
                # 1. Upload
                drive_file = upload_file_to_drive(filepath, filename)
                
                if drive_file:
                    # 2. Add to History with ID
                    download_history.append({
                        'name': filename,
                        'size': total_size,
                        'date': datetime.now().strftime('%Y-%m-%d %H:%M'),
                        'gdrive_id': drive_file.get('id'),     # Crucial for playing
                        'gdrive_link': drive_file.get('webViewLink'),
                        'storage': 'drive'
                    })

                    # 3. Delete Local File
                    if os.path.exists(filepath):
                        os.remove(filepath)
                        print(f"Deleted local file after upload: {filename}")

                    socketio_instance.emit("download_complete", {"download_id": download_id, "filename": filename})
                else:
                    raise Exception("Upload failed, no file object returned.")

                active_downloads.pop(download_id, None)

            except Exception as e:
                socketio_instance.emit("download_error", {"download_id": download_id, "error": f"Upload Error: {str(e)}"})

    except Exception as e:
        if not controller.is_paused and not controller.is_cancelled:
            socketio_instance.emit("download_error", {"download_id": download_id, "error": str(e)})

# --- SOCKET REGISTRATION ---

def background_system_stats(socketio):
    while True:
        try:
            mem = psutil.virtual_memory()
            socketio.emit('server_stats', {"ram": mem.percent})
            socketio.sleep(2)
        except: socketio.sleep(5)

def register_socket_events(socketio):
    socketio.start_background_task(background_system_stats, socketio)

    @socketio.on('connect')
    def handle_connect():
        if active_downloads:
            for did, c in active_downloads.items():
                if not c.is_cancelled:
                    if c.last_status: emit('download_progress', c.last_status)
                    elif c.is_paused: emit('download_paused', {'download_id': did})

    @socketio.on('start_download')
    def handle_start(data):
        did = str(uuid.uuid4())
        c = DownloadController(did, data['url'], data.get('filename_mode'), data.get('custom_filename'))
        active_downloads[did] = c
        
        initial = {
            'download_id': did, 'filename': 'Starting...', 'percentage': 0,
            'speed': '0 B/s', 'eta': '--', 'downloaded': 0, 'total_size': 0
        }
        c.last_status = initial
        emit('download_progress', initial)
        socketio.start_background_task(download_with_smart_filename, c, socketio)

    @socketio.on('pause_download')
    def handle_pause(data):
        did = data['download_id']
        if did in active_downloads:
            active_downloads[did].is_paused = True
            active_downloads[did].active_run_id = str(uuid.uuid4()) # Invalidate run
            emit('download_paused', {'download_id': did})

    @socketio.on('resume_download')
    def handle_resume(data):
        did = data['download_id']
        if did in active_downloads:
            c = active_downloads[did]
            c.is_paused = False
            c.active_run_id = str(uuid.uuid4())
            socketio.start_background_task(download_with_smart_filename, c, socketio)

    @socketio.on('cancel_download')
    def handle_cancel(data):
        did = data['download_id']
        if did in active_downloads:
            c = active_downloads[did]
            c.is_cancelled = True
            active_downloads.pop(did, None)
            # Cleanup if paused
            if c.is_paused and c.final_filename:
                try:
                    p = os.path.join("downloads", c.final_filename)
                    if os.path.exists(p): os.remove(p)
                except: pass
