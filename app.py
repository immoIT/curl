import os
import sys

# --- ENVIRONMENT DETECTION (Termux vs Server) ---
# Try to use Eventlet (best for high-performance servers)
# Fallback to Threading (safest for Termux/Mobile/Python 3.12+)
ASYNC_MODE = 'threading'  # Default to safe mode

try:
    import eventlet
    # CRITICAL: This must be the very first function call if eventlet is present!
    eventlet.monkey_patch()
    ASYNC_MODE = 'eventlet'
    print("System: Eventlet loaded. Using async_mode='eventlet'.")
except Exception as e:
    # Catch ALL errors.
    # ImportError = Library not installed
    # AttributeError = Python 3.12 incompatibility (ssl.wrap_socket error)
    print(f"System: Eventlet failed to load ({e}). Falling back to async_mode='threading'.")
    ASYNC_MODE = 'threading'

from flask import Flask
from flask_socketio import SocketIO
from py.curl import curl_bp, register_socket_events 

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-dev-key-change-this')

# Initialize SocketIO with the detected mode
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=ASYNC_MODE)

# Register the Blueprint (Connects routes)
app.register_blueprint(curl_bp)

# Register Socket Events (Connects socket logic)
register_socket_events(socketio)

if __name__ == "__main__":
    # socketio.run handles the web server for both modes
    socketio.run(app, debug=True, port=5000)