import eventlet
# CRITICAL: This must be the very first function call! 
# It patches standard library to be async-compatible for high performance.
eventlet.monkey_patch()

import os
from flask import Flask
from flask_socketio import SocketIO

# Import from curl.py (Ensure curl.py is in the same directory)
from py.curl import curl_bp, register_socket_events 

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-dev-key-change-this')

# Initialize SocketIO with Eventlet (Required for Render)
# cors_allowed_origins="*" allows connection from the external Render URL
# async_mode='eventlet' enforces the async worker required for stable WebSockets
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode='eventlet',
    logger=True,          # Enable logs to debug connection issues on Render
    engineio_logger=True
)

# Register the Blueprint (Connects web routes)
app.register_blueprint(curl_bp)

# Register Socket Events (Connects download progress logic)
register_socket_events(socketio)

if __name__ == "__main__":
    # Local development entry point
    # Note: On Render, Gunicorn uses the 'app' object directly, skipping this block.
    socketio.run(app, debug=True, port=5000)