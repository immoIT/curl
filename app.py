import eventlet
# CRITICAL: This must be the very first function call!
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from py.curl import curl_bp, register_socket_events
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default-dev-key-change-this')

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Register the Blueprint (Connects routes)
app.register_blueprint(curl_bp)

# Register Socket Events (Connects socket logic)
register_socket_events(socketio)

if __name__ == "__main__":
    socketio.run(app, debug=True, port=5000)
