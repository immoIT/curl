import sys

# --- CRITICAL: EVENTLET INITIALIZATION ---
# This MUST be the absolute first thing in the script.
ASYNC_MODE = 'threading' 

try:
    import eventlet
    try:
        # Attempt to patch with dns=False as requested
        eventlet.monkey_patch(socket=False, dns=False)
        print("System: Eventlet patched (socket=False, dns=False).")
    except TypeError:
        # Fallback if the specific eventlet version doesn't support 'dns' keyword
        eventlet.monkey_patch(socket=False)
        print("System: Eventlet patched (socket=False). 'dns' keyword not supported.")
    
    ASYNC_MODE = 'eventlet'
except Exception as e:
    ASYNC_MODE = 'threading'
    print(f"System: Falling back to threading logic. Reason: {e}")

import os
from flask import Flask
from flask_socketio import SocketIO
from py.curl import curl_bp, register_socket_events

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'bolt-downloader-secure-key')

# Initialize SocketIO with detected mode
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=ASYNC_MODE)

# Register Blueprints and Socket Events
app.register_blueprint(curl_bp)
register_socket_events(socketio)

if __name__ == "__main__":
    # use_reloader=False prevents double-initialization crashes on Render
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)
