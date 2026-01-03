# ================================
# app.py — Render Production Safe
# ================================

# --- CRITICAL: ASYNC DETECTION MUST BE FIRST ---
ASYNC_MODE = "threading"

try:
    import eventlet

    try:
        # Patch WITHOUT dns to avoid old eventlet crashes
        eventlet.monkey_patch(socket=False)
        ASYNC_MODE = "eventlet"
        print("System: Eventlet enabled (socket=False).")

    except Exception as e:
        print(f"System: Eventlet patch failed, using threading. Reason: {e}")
        ASYNC_MODE = "threading"

except Exception as e:
    print(f"System: Eventlet not available, using threading. Reason: {e}")
    ASYNC_MODE = "threading"


# --- STANDARD IMPORTS (AFTER PATCHING) ---
import os
from flask import Flask
from flask_socketio import SocketIO

# Your app modules
from py.curl import curl_bp, register_socket_events


# --- FLASK APP SETUP ---
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get(
    "SECRET_KEY", "bolt-downloader-secure-key"
)

# --- SOCKET.IO INIT ---
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=ASYNC_MODE,
    logger=False,
    engineio_logger=False,
)

print(f"System: SocketIO running in '{ASYNC_MODE}' mode.")


# --- REGISTER BLUEPRINTS & SOCKET EVENTS ---
app.register_blueprint(curl_bp)
register_socket_events(socketio)


# --- ENTRY POINT ---
if __name__ == "__main__":
    # use_reloader=False is REQUIRED on Render
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        use_reloader=False,
    )