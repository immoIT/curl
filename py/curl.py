from flask import Blueprint, request, render_template, jsonify, Response, stream_with_context, send_from_directory
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
import tempfile
import yt_dlp
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, unquote, parse_qs

# --- DEPENDENCY CHECKS ---
socketio_instance = None
# 1. OpenCV Check
try:
    import cv2
    OPENCV_AVAILABLE = True
except ImportError:
    cv2 = None
    OPENCV_AVAILABLE = False
    print("System: OpenCV (cv2) not found. Video resolution probing will fallback to metadata.")

# --- GOOGLE DRIVE IMPORTS ---
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

curl_bp = Blueprint('curl', __name__)

# --- CONFIG & GLOBALS ---
# FIX: Use absolute path for downloads to avoid confusion in container environments (Render)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Check if running inside 'py' folder or root
if os.path.basename(BASE_DIR) == 'py':
    BASE_DIR = os.path.dirname(BASE_DIR) # Go up one level to root

DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
TOKEN_PATH = os.path.join(BASE_DIR, 'token.json')

active_downloads = {}
download_history = [] 
SCOPES = ['https://www.googleapis.com/auth/drive'] 

def safe_filename(name):
    """Sanitizes filename to be safe for filesystems."""
    if not name: return "download"
    return (
        name.encode("ascii", "ignore")
            .decode("ascii")
            .replace(" ", "_")
    )

def ascii_filename(name):
    """Ensures filename is strictly ASCII for HTTP headers to prevent unicode errors."""
    if not name: return "download"
    try:
        # Normalize unicode characters to closest ASCII equivalent
        clean = name.encode("ascii", "ignore").decode("ascii")
        # Remove characters that are unsafe for headers
        clean = re.sub(r'[^\w\s\-\.]', '', clean)
        return clean.strip() or "download"
    except:
        return "download"

if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)

# --- YOUTUBE CONFIGURATION ---
VIDEO_FORMATS = {
    "360p": "134",
    "480p": "135",
    "720p": "136",
    "1080p": "137"
}

def get_ydl_opts(is_download=False, res_id=None):
    """
    Configuration options for yt-dlp.
    """
    opts = {
        "quiet": True,
        "no_warnings": True,
        "source_address": "0.0.0.0", # Force IPv4 to fix DNS
        "cachedir": False,
        "headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
    }
    if is_download:
        opts.update({
            "format": f"{res_id}+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": os.path.join(DOWNLOAD_DIR, "%(title)s.%(ext)s"), # Simplified template
        })
    return opts

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
    """Fetches name, mimeType, and video metadata from Drive."""
    try:
        service = get_gdrive_service()
        if not service: return {"name": "Unknown"}
        file = service.files().get(
            fileId=file_id, 
            fields="name, mimeType, size, videoMediaMetadata"
        ).execute()
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

def upload_file_to_drive(filepath, filename, progress_callback=None):
    """Uploads file with progress tracking."""
    service = get_gdrive_service()
    if not service: return None
    
    try:
        file_metadata = {'name': filename}
        media = MediaFileUpload(filepath, resumable=True, chunksize=2*1024*1024) 
        
        request = service.files().create(
            body=file_metadata, 
            media_body=media, 
            fields='id, webViewLink, webContentLink'
        )
        
        response = None
        while response is None:
            status, response = request.next_chunk()
            if status and progress_callback:
                progress_callback(status)
        
        try:
            service.permissions().create(
                fileId=response.get('id'),
                body={'type': 'anyone', 'role': 'reader'}
            ).execute()
        except: pass

        return response
    except Exception as e:
        print(f"GDrive Upload Error: {e}")
        return None

def delete_drive_file(file_id):
    """Deletes a file from Google Drive."""
    service = get_gdrive_service()
    if not service: return False
    try:
        service.files().delete(fileId=file_id).execute()
        return True
    except Exception as e:
        print(f"GDrive Delete Error: {e}")
        return False

# --- LOCAL FILE UTILITIES ---

def extract_gdrive_id(url):
    """Extracts Google Drive File ID from URL."""
    patterns = [
        r'/file/d/([^/]+)',
        r'id=([^&]+)',
        r'/open\?id=([^&]+)'
    ]
    for p in patterns:
        match = re.search(p, url)
        if match: return match.group(1)
    return None

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
    if not seconds or seconds < 0: return "--"
    try:
        m, s = divmod(int(seconds), 60)
        h, m = divmod(m, 60)
        if h > 0: return f"{h:02d}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"
    except: return "--"

# --- BLUEPRINT ROUTES ---

@curl_bp.route("/", methods=["GET"])
def index():
    return render_template('curl.html', active_view='dashboard')

@curl_bp.route("/direct", methods=["GET"])
def direct_view():
    return render_template('curl.html', active_view='direct')

@curl_bp.route("/drive", methods=["GET"])
def drive_view():
    return render_template('curl.html', active_view='drive')

@curl_bp.route("/youtube", methods=["GET"])
def youtube_view():
    return render_template('curl.html', active_view='youtube')

@curl_bp.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({"status": "ok"}), 200

# --- YOUTUBE ROUTES ---

@curl_bp.route('/youtube/fetch_info', methods=['POST'])
def fetch_info():
    data = request.get_json()
    url = data.get('url')
    
    try:
        with yt_dlp.YoutubeDL(get_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = info.get("duration", 0)
            
            # Audio logic
            audio_formats = [f for f in info.get("formats", []) if f.get("acodec") != "none" and f.get("abr")]
            best_audio = max(audio_formats, key=lambda x: x["abr"], default=None)
            audio_size = (best_audio["abr"] * 1000 * duration) / 8 if best_audio else 0
            
            available = []
            for res, vid_id in VIDEO_FORMATS.items():
                v_fmt = next((f for f in info.get("formats", []) if f.get("format_id") == vid_id), None)
                if v_fmt:
                    v_size = v_fmt.get("filesize") or v_fmt.get("filesize_approx") or 0
                    if v_size > 0:
                        total_mb = round((v_size + audio_size) / (1024 * 1024), 2)
                        available.append({"res": res, "size": f"{total_mb} MB"})
            
            return jsonify({
                'success': True, 
                'title': info.get("title"), 
                'thumbnail': info.get("thumbnail"), 
                'duration': time.strftime('%H:%M:%S', time.gmtime(duration)), 
                'formats': available
            })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@curl_bp.route('/youtube/download_and_upload', methods=['POST'])
def youtube_download_task():
    data = request.get_json()
    url = data.get('url')
    res = data.get('resolution')

    if not url or not res:
        return jsonify(success=False, error="Invalid request")

    download_id = f"yt_{int(time.time())}"

    def task():
        filepath = None
        try:
            # ---- DOWNLOAD (NO SOCKET EMIT, JUST BACKGROUND) ----
            # We don't want to block the user or confuse them with "Downloading 0%" while YT processes
            ydl_opts = get_ydl_opts(is_download=True, res_id=VIDEO_FORMATS[res])
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filepath = ydl.prepare_filename(info)
                filename = os.path.basename(filepath)

            total_size = os.path.getsize(filepath)

            # ---- START UPLOAD (SHOW ACTIVE DOWNLOAD) ----
            if socketio_instance:
                socketio_instance.emit("download_progress", {
                    "download_id": download_id,
                    "filename": filename,
                    "phase": "uploading",
                    "percentage": 0,
                    "speed": "Uploading...",
                    "eta": "--",
                    "downloaded": 0,
                    "total_size": total_size
                })

            # ---- UPLOAD TO GOOGLE DRIVE ----
            drive_file = upload_file_to_drive(
                filepath,
                filename,
                lambda status: socketio_instance.emit("download_progress", {
                    "download_id": download_id,
                    "filename": filename,
                    "phase": "uploading",
                    "percentage": int(status.progress() * 100),
                    "speed": "Uploading...",
                    "eta": "--",
                    "downloaded": int(status.progress() * total_size),
                    "total_size": total_size
                }) if socketio_instance else None
            )

            # ---- SAVE TO LIBRARY ----
            download_history.append({
                "name": filename,
                "size": total_size,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "gdrive_id": drive_file.get("id") if drive_file else None
            })

            if socketio_instance:
                socketio_instance.emit("download_complete", {
                    "download_id": download_id,
                    "filename": filename
                })

            if filepath and os.path.exists(filepath):
                os.remove(filepath)

        except Exception as e:
            if socketio_instance:
                socketio_instance.emit("download_error", {
                    "download_id": download_id,
                    "error": str(e)
                })

            if filepath and os.path.exists(filepath):
                os.remove(filepath)

    threading.Thread(target=task, daemon=True).start()
    return jsonify(success=True)

# --- UTILITY ROUTES ---

@curl_bp.route("/detect_filename", methods=["POST"])
def detect_filename_route():
    data = request.get_json()
    url = data.get('url', '')
    if not url: return jsonify({'success': False})
    
    gid = extract_gdrive_id(url)
    if gid:
        meta = get_file_metadata(gid)
        name = meta.get('name')
        if name and name != "Unknown":
            return jsonify({'success': True, 'filename': name})
            
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
    
    target_file = next((f for f in download_history if f['name'] == filename), None)
    if target_file and target_file.get('gdrive_id'):
        delete_drive_file(target_file['gdrive_id'])
    
    download_history = [f for f in download_history if f['name'] != filename]
    
    try:
        path = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.exists(path): os.remove(path)
    except: pass
    
    return jsonify({'success': True})

@curl_bp.route("/upload_sub", methods=["POST"])
def upload_sub():
    if 'file' not in request.files: return jsonify({'success': False, 'error': 'No file'})
    file = request.files['file']
    if file.filename == '': return jsonify({'success': False, 'error': 'No file'})
    
    if file:
        filename = re.sub(r'[<>:"/\\|?*]', '_', file.filename)
        save_path = os.path.join(DOWNLOAD_DIR, filename)
        file.save(save_path)
        try:
            drive_file = upload_file_to_drive(save_path, filename)
            if os.path.exists(save_path): os.remove(save_path)
            if drive_file:
                return jsonify({'success': True, 'name': filename, 'file_id': drive_file.get('id')})
            return jsonify({'success': False, 'error': 'Upload failed'})
        except Exception as e:
            if os.path.exists(save_path): os.remove(save_path)
            return jsonify({'success': False, 'error': str(e)})

@curl_bp.route("/get_subs", methods=["GET"])
def get_subs():
    return jsonify([])

@curl_bp.route("/video_meta/<file_id>", methods=["GET"])
def get_video_meta(file_id):
    creds = get_credentials()
    if not creds: return jsonify({'error': 'Unauthorized'}), 401

    stream_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    headers = {"Authorization": f"Bearer {creds.token}"}
    
    try:
        tmp_path = None
        if OPENCV_AVAILABLE:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
                tmp_path = tmp_file.name
                with requests.get(stream_url, headers=headers, stream=True) as r:
                    for chunk in r.iter_content(chunk_size=4096):
                        tmp_file.write(chunk)
                        if tmp_file.tell() > 10 * 1024 * 1024: break
        
        width, height = 0, 0
        source = 'metadata'

        if OPENCV_AVAILABLE and tmp_path:
            try:
                cap = cv2.VideoCapture(tmp_path)
                if cap.isOpened():
                    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    cap.release()
                    source = 'opencv_probe'
            except Exception as e:
                print(f"OpenCV Probe Error: {e}")
        
        if tmp_path and os.path.exists(tmp_path): os.remove(tmp_path)

        if width == 0 or height == 0:
            meta = get_file_metadata(file_id)
            video_meta = meta.get('videoMediaMetadata', {})
            width = video_meta.get('width', 0)
            height = video_meta.get('height', 0)
            source = 'metadata_fallback'

        return jsonify({'width': width, 'height': height, 'source': source})
    except Exception as e:
        return jsonify({'width': 0, 'height': 0, 'error': str(e)})

# --- STREAMING ROUTES ---

@curl_bp.route('/download_drive/<file_id>')
def download_drive(file_id):
    return stream_drive_content(file_id, as_attachment=True)

@curl_bp.route('/stream_drive/<file_id>')
def stream_drive(file_id):
    return stream_drive_content(file_id, as_attachment=False)

def stream_drive_content(file_id, as_attachment=False):
    creds = get_credentials()
    if not creds: return "Credentials error", 401

    meta = get_file_metadata(file_id)
    raw_name = meta.get('name', 'downloaded_file')
    if not raw_name: raw_name = "downloaded_file"
    
    filename = raw_name.lower()
    
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    headers = {"Authorization": f"Bearer {creds.token}"}
    
    range_header = request.headers.get('Range', None)
    if not as_attachment and range_header: 
        headers['Range'] = range_header

    req = requests.get(url, headers=headers, stream=True)
    
    if not as_attachment and filename.endswith('.srt'):
        return Response(srt_to_vtt(req.content), content_type="text/vtt")
    
    content_type = req.headers.get("Content-Type")
    if filename.endswith('.vtt'): content_type = "text/vtt"
    
    excluded_headers = ['content-encoding', 'transfer-encoding', 'connection', 'authorization', 'content-disposition']
    if not as_attachment and filename.endswith('.srt'): 
        excluded_headers.append('content-length')
    
    response_headers = [(n, v) for (n, v) in req.headers.items() if n.lower() not in excluded_headers]

    # FIX: Robust ASCII conversion for Content-Disposition header
    # This prevents crashes when streaming files with emojis/unicode in their names
    ascii_name = ascii_filename(raw_name)
    disposition = 'attachment' if as_attachment else 'inline'

    response_headers.append(
        ('Content-Disposition', f'{disposition}; filename="{ascii_name}"')
    )

    return Response(stream_with_context(req.iter_content(chunk_size=65536)), 
                   status=req.status_code, headers=response_headers, content_type=content_type)

@curl_bp.route('/stream/<filename>')
def stream_file(filename):
    # FIX: Use absolute path join
    file_path = os.path.join(DOWNLOAD_DIR, filename)
    if not os.path.exists(file_path): return "File not found", 404

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
                chunk = f.read(min(65536, remaining))
                if not chunk: break
                yield chunk
                remaining -= len(chunk)

    rv = Response(generate(), 206, mimetype=mimetypes.guess_type(file_path)[0], direct_passthrough=True)
    rv.headers.add('Content-Range', f'bytes {byte1}-{byte1+length-1}/{file_size}')
    return rv

# --- CONTROLLER ---

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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })

    def determine_filename(self, response_headers=None):
        if self.final_filename: return self.final_filename
        self.final_filename = get_smart_filename(self.url, response_headers, self.custom_filename)
        return self.final_filename

def download_with_smart_filename(controller, socketio_instance):
    download_id = controller.download_id
    url = controller.url
    current_run_id = controller.active_run_id
    
    try:
        # --- 1. HANDLE GDRIVE LINKS AUTOMATICALLY ---
        gid = extract_gdrive_id(url)
        if gid:
            creds = get_credentials()
            if creds:
                url = f"https://www.googleapis.com/drive/v3/files/{gid}?alt=media"
                controller.session.headers.update({"Authorization": f"Bearer {creds.token}"})
                if not controller.final_filename:
                    meta = get_file_metadata(gid)
                    controller.final_filename = meta.get('name')

        # --- 2. DETERMINE FILENAME ---
        if not controller.final_filename:
            try:
                head = controller.session.head(url, timeout=10, allow_redirects=True)
                controller.determine_filename(head.headers)
            except: controller.determine_filename()
        
        filename = controller.final_filename
        filepath = os.path.join(DOWNLOAD_DIR, filename)

        if controller.is_cancelled: return

        # --- 3. DOWNLOAD PHASE ---
        resume_byte_pos = os.path.getsize(filepath) if os.path.exists(filepath) else 0
        headers = {}
        if resume_byte_pos > 0: headers["Range"] = f"bytes={resume_byte_pos}-"

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
                            
                            rem_bytes = total_size - downloaded
                            eta = format_time(rem_bytes / speed if speed > 0 else 0)
                            
                            status = {
                                "download_id": download_id,
                                "filename": filename,
                                "phase": "downloading",
                                "percentage": pct,
                                "speed": format_speed(speed),
                                "eta": eta,
                                "downloaded": downloaded,
                                "total_size": total_size
                            }
                            controller.last_status = status
                            if socketio_instance:
                                socketio_instance.emit("download_progress", status)
                            last_emit = now

        if controller.is_cancelled:
            if os.path.exists(filepath): os.remove(filepath)
            active_downloads.pop(download_id, None)
            return

        # --- 4. UPLOAD PHASE ---
        if not controller.is_paused and controller.active_run_id == current_run_id:
            if socketio_instance:
                socketio_instance.emit("download_progress", {
                    "download_id": download_id,
                    "filename": filename,
                    "phase": "uploading",
                    "percentage": 0,
                    "speed": "Starting upload...",
                    "eta": "--",
                    "downloaded": 0,
                    "total_size": total_size
                })

            upload_start_time = time.time()
            last_upload_emit = 0
            
            def upload_callback(status):
                nonlocal last_upload_emit
                now = time.time()
                if now - last_upload_emit >= 0.5:
                    progress_bytes = status.resumable_progress
                    total_bytes = status.total_size
                    elapsed = now - upload_start_time
                    up_speed = progress_bytes / max(elapsed, 0.1)
                    rem_bytes = total_bytes - progress_bytes
                    eta = format_time(rem_bytes / up_speed if up_speed > 0 else 0)
                    
                    status_payload = {
                        "download_id": download_id,
                        "filename": filename,
                        "phase": "uploading",
                        "percentage": status.progress() * 100,
                        "speed": format_speed(up_speed),
                        "eta": eta,
                        "downloaded": progress_bytes,
                        "total_size": total_bytes
                    }
                    controller.last_status = status_payload
                    if socketio_instance:
                        socketio_instance.emit("download_progress", status_payload)
                    last_upload_emit = now

            try:
                drive_file = upload_file_to_drive(filepath, filename, progress_callback=upload_callback)
                if drive_file:
                    download_history.append({
                        'name': filename,
                        'size': total_size,
                        'date': datetime.now().strftime('%Y-%m-%d %H:%M'),
                        'gdrive_id': drive_file.get('id'),
                        'gdrive_link': drive_file.get('webViewLink'),
                        'storage': 'drive'
                    })
                    if os.path.exists(filepath): os.remove(filepath)
                    if socketio_instance:
                        socketio_instance.emit("download_complete", {"download_id": download_id, "filename": filename})
                else:
                    raise Exception("Upload failed, no file object returned.")
                active_downloads.pop(download_id, None)

            except Exception as e:
                if socketio_instance:
                    socketio_instance.emit("download_error", {"download_id": download_id, "error": f"Upload Error: {str(e)}"})

    except Exception as e:
        if not controller.is_paused and not controller.is_cancelled:
            if socketio_instance:
                socketio_instance.emit("download_error", {"download_id": download_id, "error": str(e)})

# --- SOCKET ---

def background_system_stats(socketio):
    while True:
        try:
            mem = psutil.virtual_memory()
            socketio.emit('server_stats', {"ram": mem.percent})
            time.sleep(2) 
        except Exception: 
            time.sleep(5)

def register_socket_events(socketio):
    global socketio_instance
    socketio_instance = socketio
    threading.Thread(target=background_system_stats, args=(socketio,), daemon=True).start()

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
        
        c = DownloadController(
            did, 
            data['url'], 
            data.get('filename_mode'), 
            data.get('custom_filename')
        )
        active_downloads[did] = c
        
        emit('download_progress', {
            'download_id': did, 'filename': 'Starting...', 'phase': 'downloading', 'percentage': 0,
            'speed': '0 B/s', 'eta': '--', 'downloaded': 0, 'total_size': 0
        })
        
        threading.Thread(target=download_with_smart_filename, args=(c, socketio)).start()

    @socketio.on('pause_download')
    def handle_pause(data):
        if data['download_id'] in active_downloads:
            active_downloads[data['download_id']].is_paused = True
            active_downloads[data['download_id']].active_run_id = str(uuid.uuid4())
            emit('download_paused', {'download_id': data['download_id']})

    @socketio.on('resume_download')
    def handle_resume(data):
        if data['download_id'] in active_downloads:
            c = active_downloads[data['download_id']]
            c.is_paused = False
            c.active_run_id = str(uuid.uuid4())
            threading.Thread(target=download_with_smart_filename, args=(c, socketio)).start()

    @socketio.on('cancel_download')
    def handle_cancel(data):
        did = data['download_id']
        if did in active_downloads:
            c = active_downloads[did]
            c.is_cancelled = True
            # Don't pop immediately, let the thread handle cleanup
            if c.is_paused:
                active_downloads.pop(did, None)
                if c.final_filename:
                    try: 
                        p = os.path.join(DOWNLOAD_DIR, c.final_filename)
                        if os.path.exists(p): os.remove(p)
                    except: pass