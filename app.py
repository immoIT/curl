import eventlet
# CRITICAL: This must be the very first function call!
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from curl.curl import curl_bp, register_sockets

app = Flask(__name__)
app.config['SECRET_KEY'] = 'default-dev-key-change-this'

# Initialize SocketIO
# async_mode='eventlet' is required for the background tasks to work correctly
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Register the Blueprint
# We use url_prefix='' so routes like /detect_filename work at the root level
app.register_blueprint(curl_bp, url_prefix='')

# Pass the socketio instance to the module to register events
register_sockets(socketio)

if __name__ == "__main__":
    socketio.run(app, debug=True, port=5000)
