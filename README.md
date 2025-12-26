# ⚡ Bolt Downloader

Bolt Downloader is a modern **Python Flask + Socket.IO** based web application that lets you download files from **direct URLs** and **Google Drive links** with a clean UI, real-time progress, pause/resume support, and smart filename detection.

---

## 🚀 Features

* 🌐 Download files from **any direct HTTP/HTTPS URL**
* 📁 Convert **Google Drive share links** into direct downloadable links
* 📊 Real-time download progress (speed, ETA, size)
* ⏸ Pause & ▶ Resume downloads
* ❌ Cancel downloads safely
* ✏️ Auto-detect filename with rename option
* 🗂 View and manage downloaded files
* 🌙 Light / Dark mode support
* ⚡ Fast multi-threaded downloads

---

## 🧰 Tech Stack

* **Backend:** Python, Flask, Flask-SocketIO
* **Frontend:** Bootstrap 5, JavaScript, Socket.IO
* **Networking:** Requests
* **Concurrency:** ThreadPoolExecutor
* **Database:** SQLite (structure-ready)

---

## 📂 Project Structure

```
.
├── curl.py           # Main application file
├── downloads/        # Downloaded files are stored here
├── downloads.db      # SQLite database (auto-created)
└── README.md
```

---

## 🖥 Requirements

* Python **3.8 or higher**
* Internet connection

### Required Python Packages

```
flask
flask-socketio
requests
```

Install all dependencies:

```
pip install flask flask-socketio requests
```

---

## ▶️ How to Run

1. Clone or download this project
2. Open terminal in the project folder
3. Run the app:

```
python curl.py
```

4. The app will automatically open in your browser:

```
http://127.0.0.1:5001
```

---

## 🔗 Google Drive Link Support

Supported formats:

* Share URL:

```
https://drive.google.com/file/d/FILE_ID/view?usp=sharing
```

* UC Format (Auto-generated):

```
https://drive.google.com/uc?export=download&id=FILE_ID
```

Just paste the Drive link — the app converts it automatically.

---

## 📥 Download Controls

* **Pause** – Temporarily stop download
* **Resume** – Continue from where it stopped
* **Cancel** – Stop and delete partial file
* **Rename** – Edit filename before download

---

## 🔐 Security Notes

* Blocks invalid filenames
* Prevents path traversal
* Uses safe headers and sessions

---

## 🛠 Customization

You can change:

* Port number (default: `5001`)
* Download folder name
* UI theme colors
* Maximum parallel downloads

---

## 📜 License

This project is **free to use** for personal and educational purposes.

---

## ❤️ Credits

Developed using Python & Flask with a modern UI for fast and reliable downloads.

Happy Downloading ⚡
