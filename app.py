import eventlet
# CRITICAL: This must be the very first function call!
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from curl.curl import curl_bp, register_sockets

app = Flask(__name__)
app.config['SECRET_KEY'] = 'default-dev-key-change-this'

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Register the Blueprint from the curl folder
# url_prefix='' ensures the app runs at the root domain
app.register_blueprint(curl_bp, url_prefix='')

# Connect the socket events from the curl module
register_sockets(socketio)

if __name__ == "__main__":
    socketio.run(app, debug=True, port=5000)
