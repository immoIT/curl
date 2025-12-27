// --- Theme Toggle Logic ---
const toggle = document.getElementById('darkModeToggle');
const themeIcon = document.getElementById('themeIcon');

function updateThemeIcon(isDark) {
    themeIcon.className = isDark ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    toggle.checked = true;
    updateThemeIcon(true);
} else {
    updateThemeIcon(false);
}

toggle.addEventListener('change', () => {
    const isDark = toggle.checked;
    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
});

// --- Logic ---
const socket = io();
let activeDownloadCount = 0;
const cancelledIds = new Set();
let playerModalInstance = null;
let hlsInstance = null;
let currentFileId = null;

socket.on('connect', () => {
    const status = document.getElementById('connectionStatus');
    status.className = 'badge bg-success';
    status.innerHTML = '<i class="bi bi-dot"></i> Connected';
    document.getElementById('activeDownloads').innerHTML = `<span class="text-muted">No active downloads running</span>`;
});

socket.on('disconnect', () => {
    const status = document.getElementById('connectionStatus');
    status.className = 'badge bg-danger';
    status.innerHTML = '<i class="bi bi-dot"></i> Disconnected';
});

socket.on('download_progress', (data) => {
    activeDownloadCount = Object.keys(data).length > 0 ? 1 : 0;
    
    const container = document.getElementById('activeDownloads');
    let html = `
        <div class="download-item p-3 border rounded mb-2">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <strong class="text-truncate">${data.filename}</strong>
                <button class="btn btn-sm btn-outline-danger" onclick="cancelDownload('${data.download_id}')">
                    <i class="bi bi-x-circle"></i> Cancel
                </button>
            </div>
            <div class="progress mb-2">
                <div class="progress-bar" style="width: ${data.percentage}%"></div>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">${formatBytes(data.downloaded)} / ${formatBytes(data.total_size)}</small>
                <small class="text-muted">${data.speed} | ETA: ${data.eta}</small>
            </div>
        </div>
    `;
    container.innerHTML = html;
});

socket.on('download_complete', (data) => {
    activeDownloadCount = 0;
    document.getElementById('activeDownloads').innerHTML = `<span class="text-muted">No active downloads running</span>`;
    
    // Refresh files list
    setTimeout(() => {
        loadFiles();
    }, 500);
    
    // Show success toast
    showToast('Success', `${data.filename} uploaded to Google Drive!`, 'success');
});

socket.on('download_error', (data) => {
    activeDownloadCount = 0;
    document.getElementById('activeDownloads').innerHTML = `<span class="text-danger">Error: ${data.error}</span>`;
    showToast('Error', data.error, 'danger');
});

socket.on('download_paused', (data) => {
    console.log('Download paused:', data.download_id);
});

socket.on('server_stats', (stats) => {
    const ramPercentage = stats.ram.toFixed(1);
    const ramUsed = stats.ram_used.toFixed(1);
    const ramTotal = stats.ram_total.toFixed(1);
    
    const statsElement = document.getElementById('serverStats');
    if (statsElement) {
        statsElement.innerHTML = `<span class="text-muted text-sm">RAM: ${ramUsed}MB / ${ramTotal}MB (${ramPercentage}%)</span>`;
    }
});

// --- Helper Functions ---
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function showToast(title, message, type = 'info') {
    const toastHtml = `
        <div class="toast align-items-center text-white bg-${type} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    <strong>${title}:</strong> ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    
    const container = document.getElementById('toastContainer') || createToastContainer();
    const toastEl = document.createElement('div');
    toastEl.innerHTML = toastHtml;
    container.appendChild(toastEl.firstElementChild);
    
    const toast = new bootstrap.Toast(toastEl.firstElementChild);
    toast.show();
    
    setTimeout(() => {
        toastEl.firstElementChild.remove();
    }, 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
    return container;
}

// --- PLAYER FUNCTIONS (from test.py) ---
function playFile(fileId, fileName) {
    currentFileId = fileId;
    
    // Set video source
    const videoElement = document.getElementById('playerVideo');
    if (videoElement) {
        videoElement.src = `/stream_drive/${fileId}`;
    }
    
    // Load subtitles
    loadSubtitles();
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('playerModal'));
    modal.show();
    playerModalInstance = modal;
    
    // Update title
    const titleEl = document.getElementById('playerTitle');
    if (titleEl) {
        titleEl.textContent = fileName;
    }
}

function loadSubtitles() {
    fetch('/get_subs')
        .then(res => res.json())
        .then(subs => {
            const videoElement = document.getElementById('playerVideo');
            if (videoElement) {
                // Clear existing tracks
                Array.from(videoElement.querySelectorAll('track')).forEach(t => t.remove());
                
                // Add subtitle tracks
                subs.forEach((sub, index) => {
                    const track = document.createElement('track');
                    track.kind = 'subtitles';
                    track.label = sub.name;
                    track.src = `/stream_sub/${sub.id}`;
                    if (index === 0) track.default = true;
                    videoElement.appendChild(track);
                });
            }
        })
        .catch(err => console.error('Error loading subtitles:', err));
}

document.getElementById('uploadSubtitleBtn')?.addEventListener('click', () => {
    document.getElementById('subtitleInput').click();
});

document.getElementById('subtitleInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    fetch('/upload_sub', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showToast('Success', 'Subtitle uploaded!', 'success');
            loadSubtitles();
        } else {
            showToast('Error', data.error || 'Upload failed', 'danger');
        }
    })
    .catch(err => {
        showToast('Error', 'Upload failed: ' + err.message, 'danger');
    });
});

// Video quality controls
document.getElementById('qualitySelect')?.addEventListener('change', (e) => {
    const videoElement = document.getElementById('playerVideo');
    if (videoElement) {
        const quality = e.target.value;
        // Quality switching logic here
        console.log('Quality changed to:', quality);
    }
});

// Playback speed controls
document.getElementById('speedSelect')?.addEventListener('change', (e) => {
    const videoElement = document.getElementById('playerVideo');
    if (videoElement) {
        videoElement.playbackRate = parseFloat(e.target.value);
    }
});

// Subtitle controls
document.getElementById('subtitleSelect')?.addEventListener('change', (e) => {
    const videoElement = document.getElementById('playerVideo');
    if (videoElement) {
        const tracks = videoElement.querySelectorAll('track');
        tracks.forEach((track, index) => {
            track.track.mode = index === parseInt(e.target.value) ? 'showing' : 'hidden';
        });
    }
});

// --- FILE MANAGEMENT ---
async function loadFiles() {
    try {
        const response = await fetch('/list_files');
        const data = await response.json();
        const filesList = document.getElementById('downloadFilesList');
        
        if (!filesList) return;
        
        if (data.files.length === 0) {
            filesList.innerHTML = '<p class="text-muted">No files downloaded yet</p>';
            return;
        }
        
        let html = '<div class="row">';
        data.files.forEach(file => {
            const isGDriveFile = file.storage === 'drive';
            const fileSize = typeof file.size === 'number' ? formatBytes(file.size) : 'Unknown';
            
            html += `
                <div class="col-md-4 mb-3">
                    <div class="card">
                        <div class="card-body">
                            <h6 class="card-title text-truncate" title="${file.name}">${file.name}</h6>
                            <small class="text-muted d-block">
                                Size: ${fileSize}
                            </small>
                            <small class="text-muted d-block">
                                ${file.date || 'Recently'}
                            </small>
                            <div class="mt-3 d-flex gap-2">
                                <button class="btn btn-sm btn-primary" onclick="playFile('${file.gdrive_id || file.name}', '${file.name}')">
                                    <i class="bi bi-play-circle"></i> Play
                                </button>
                                ${isGDriveFile ? `
                                    <a href="${file.gdrive_link}" target="_blank" class="btn btn-sm btn-info">
                                        <i class="bi bi-google"></i> Drive
                                    </a>
                                ` : ''}
                                <button class="btn btn-sm btn-danger" onclick="deleteFile('${file.name}')">
                                    <i class="bi bi-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        filesList.innerHTML = html;
    } catch (error) {
        console.error('Error loading files:', error);
        document.getElementById('downloadFilesList').innerHTML = '<p class="text-danger">Error loading files</p>';
    }
}

async function deleteFile(filename) {
    if (!confirm(`Delete "${filename}"?`)) return;
    
    try {
        const response = await fetch('/delete_file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('Success', 'File deleted', 'success');
            loadFiles();
        } else {
            showToast('Error', data.error || 'Delete failed', 'danger');
        }
    } catch (error) {
        showToast('Error', 'Delete failed: ' + error.message, 'danger');
    }
}

// --- DOWNLOAD FORM ---
document.getElementById('downloadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('urlInput').value.trim();
    const filename = document.getElementById('filenameInput').value.trim();
    const filenameMode = filename ? 'custom' : 'original';
    
    if (!url) {
        showToast('Error', 'Please enter a URL', 'danger');
        return;
    }
    
    // Convert Google Drive URLs
    try {
        if (url.includes('drive.google.com')) {
            const convResponse = await fetch('/convert_gdrive_url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            const convData = await convResponse.json();
            if (convData.success) {
                var finalUrl = convData.direct_url;
            } else {
                var finalUrl = url;
            }
        } else {
            var finalUrl = url;
        }
    } catch (err) {
        console.warn('URL conversion failed:', err);
        var finalUrl = url;
    }
    
    // Start download
    socket.emit('start_download', {
        url: finalUrl,
        filename_mode: filenameMode,
        custom_filename: filename
    });
    
    document.getElementById('downloadForm').reset();
});

function cancelDownload(downloadId) {
    socket.emit('cancel_download', { download_id: downloadId });
    cancelledIds.add(downloadId);
}

// Load files on page load
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    
    // Auto-detect filename
    document.getElementById('urlInput')?.addEventListener('change', async (e) => {
        const url = e.target.value.trim();
        if (!url) return;
        
        try {
            const response = await fetch('/detect_filename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            const data = await response.json();
            if (data.success && data.filename) {
                document.getElementById('filenameInput').placeholder = `Detected: ${data.filename}`;
            }
        } catch (err) {
            console.warn('Filename detection failed:', err);
        }
    });
    
    // Refresh files list every 5 seconds
    setInterval(loadFiles, 5000);
});
