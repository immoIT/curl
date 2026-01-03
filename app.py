import os
import sys

# --- ENVIRONMENT DETECTION ---
ASYNC_MODE = 'threading' 

try:
    import eventlet
    # We still keep socket/dns False to avoid the YouTube DNS resolution error
    eventlet.monkey_patch(socket=False, dns=False)
    ASYNC_MODE = 'eventlet'
    print("System: Eventlet loaded (Socket/DNS patching disabled).")
except Exception as e:
    print(f"System: Falling back to threading ({e})")
    ASYNC_MODE = 'threading'

from flask import Flask
from flask_socketio import SocketIO
from py.curl import curl_bp, register_socket_events

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'bolt-downloader-secure-key')

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=ASYNC_MODE)

# Register the Blueprint (Connects routes)
app.register_blueprint(curl_bp)

# Register Socket Events (Connects socket logic)
register_socket_events(socketio)

if __name__ == "__main__":
    # FIX: Set use_reloader=False to prevent the WERKZEUG_SERVER_FD KeyError
    # We keep debug=True for logs, but disable the reloader which causes the crash
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)
