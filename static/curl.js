// - Full Client-Side Logic

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

// --- Socket & Dashboard Logic ---
const socket = io();
let activeDownloadCount = 0;
const cancelledIds = new Set();

socket.on('connect', () => {
    const status = document.getElementById('connectionStatus');
    status.className = 'badge bg-success';
    status.innerHTML = '<i class="bi bi-wifi"></i> Connected';
    
    document.getElementById('activeDownloads').innerHTML = `
        <div id="emptyState" class="text-center py-5 text-muted opacity-50">
            <i class="bi bi-cloud-download display-1"></i>
            <p class="mt-3">No active downloads running</p>
        </div>`;
    activeDownloadCount = 0;
    document.getElementById('activeCount').innerText = 0;
    loadSavedFiles();
});

socket.on('disconnect', () => {
    const status = document.getElementById('connectionStatus');
    status.className = 'badge bg-danger';
    status.innerHTML = '<i class="bi bi-wifi-off"></i> Offline';
});

// --- SERVER STATS LISTENER ---
socket.on('server_stats', (data) => {
    const ramBadge = document.getElementById('ramUsage');
    if (ramBadge) {
        ramBadge.innerHTML = `<i class="bi bi-memory me-1"></i>RAM: ${data.ram}%`;
        ramBadge.classList.remove('bg-success', 'bg-warning', 'bg-danger', 'text-dark');
        if(data.ram < 60) ramBadge.classList.add('bg-success');
        else if (data.ram < 85) ramBadge.classList.add('bg-warning', 'text-dark');
        else ramBadge.classList.add('bg-danger');
    }
});

socket.on('download_progress', (data) => updateDownloadUI(data));
socket.on('download_complete', (data) => handleComplete(data));
socket.on('download_error', (data) => handleError(data));
socket.on('download_paused', (data) => handlePaused(data));

// --- Form Handling ---

document.getElementById('downloadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('url').value.trim();
    const custom = document.getElementById('customFilename').value.trim();
    const mode = custom ? 'custom' : 'original';
    
    if(!url) return showToast('Please enter a URL', 'danger');
    
    socket.emit('start_download', {
        url: url,
        filename_mode: mode,
        custom_filename: custom
    });
    showToast('Download started', 'primary');
    
    document.getElementById('url').value = '';
    document.getElementById('customFilename').value = '';
    document.getElementById('filenamePreviewWrapper').style.display = 'none';
});

// --- Filename Editing Logic ---
function enableEditMode() {
    const previewText = document.getElementById('filenamePreview').innerText;
    const input = document.getElementById('customFilename');
    const displayMode = document.getElementById('previewModeDisplay');

    input.value = previewText;
    displayMode.style.display = 'none';
    input.style.display = 'block';
    input.focus();
}

// --- DYNAMIC MODAL LOGIC (PAUSE / DELETE / CANCEL) ---
let confirmCallback = null;
const confirmModalEl = document.getElementById('confirmModal');
const confirmModal = new bootstrap.Modal(confirmModalEl);
const confirmBtn = document.getElementById('confirmActionBtn');

function showConfirm(config, callback) {
    document.getElementById('modalTitle').textContent = config.title;
    document.getElementById('confirmMessage').textContent = config.message;
    confirmBtn.textContent = config.btnText;
    confirmBtn.className = 'btn px-4 ' + config.btnClass;
    document.getElementById('modalIcon').className = 'bi display-3 mb-3 d-block ' + config.iconClass;

    confirmCallback = callback;
    confirmModal.show();
}

confirmBtn.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmModal.hide();
});

// --- Download UI Functions ---

function updateDownloadUI(data) {
    if(cancelledIds.has(data.download_id)) return;

    const container = document.getElementById('activeDownloads');
    let el = document.getElementById(`download-${data.download_id}`);
    
    document.getElementById('emptyState').style.display = 'none';
    
    if (!el) {
        el = createDownloadItem(data);
        container.prepend(el);
        activeDownloadCount++;
        document.getElementById('activeCount').innerText = activeDownloadCount;
    } else {
        el.classList.remove('paused', 'error');
        const pauseBtn = el.querySelector('.btn-pause');
        const resumeBtn = el.querySelector('.btn-resume');
        if(pauseBtn) pauseBtn.style.display = 'inline-block';
        if(resumeBtn) resumeBtn.style.display = 'none';
    }

    const bar = el.querySelector('.progress-bar');
    bar.style.width = `${data.percentage}%`;
    
    // Upload State Handling
    if (data.speed && data.speed.includes("Uploading")) {
        bar.classList.add('progress-bar-striped', 'progress-bar-animated');
        bar.classList.remove('bg-primary');
        bar.classList.add('bg-info');
    } else {
        bar.classList.remove('bg-info');
        bar.classList.add('bg-primary');
    }
    
    el.querySelector('.filename').innerText = data.filename;
    el.querySelector('.percent').innerText = `${data.percentage.toFixed(1)}%`;
    el.querySelector('.speed').innerText = data.speed;
    el.querySelector('.eta').innerText = data.eta;
    el.querySelector('.downloaded').innerText = formatBytes(data.downloaded) + ' / ' + formatBytes(data.total_size);
}

function createDownloadItem(data) {
    const div = document.createElement('div');
    div.id = `download-${data.download_id}`;
    div.className = 'download-item';
    div.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
                <h6 class="filename fw-bold mb-0 text-truncate" style="max-width: 300px;">${data.filename}</h6>
                <small class="text-muted status-text">Downloading...</small>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-outline-warning btn-pause" onclick="pauseDownload('${data.download_id}')" title="Pause">
                    <i class="bi bi-pause-fill"></i>
                </button>
                <button class="btn btn-sm btn-outline-success btn-resume" onclick="resumeDownload('${data.download_id}')" title="Resume" style="display:none;">
                    <i class="bi bi-play-fill"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="cancelDownload('${data.download_id}')" title="Cancel">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
        </div>
        <div class="progress">
            <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
        </div>
        <div class="download-meta d-flex justify-content-between">
            <span><i class="bi bi-hdd me-1"></i><span class="downloaded">0/0</span></span>
            <span><i class="bi bi-speedometer2 me-1"></i><span class="speed">0 B/s</span></span>
            <span><i class="bi bi-clock me-1"></i><span class="eta">--</span></span>
            <span class="fw-bold percent text-primary">0%</span>
        </div>
    `;
    return div;
}

function handlePaused(data) {
    if(cancelledIds.has(data.download_id)) return;
    const el = document.getElementById(`download-${data.download_id}`);
    if (el) {
        el.classList.add('paused');
        el.querySelector('.status-text').innerText = 'Paused';
        el.querySelector('.progress-bar').classList.remove('progress-bar-animated');
        el.querySelector('.btn-pause').style.display = 'none';
        el.querySelector('.btn-resume').style.display = 'inline-block';
        showToast('Download paused', 'warning');
    }
}

function handleComplete(data) {
    if(cancelledIds.has(data.download_id)) return;
    const el = document.getElementById(`download-${data.download_id}`);
    if (el) {
        el.classList.remove('paused');
        const bar = el.querySelector('.progress-bar');
        bar.classList.remove('progress-bar-animated', 'progress-bar-striped', 'bg-info');
        bar.classList.add('bg-success');
        bar.style.width = '100%';
        
        el.querySelector('.status-text').innerHTML = '<span class="text-success">Completed</span>';
        el.querySelector('.btn-group').innerHTML = `<a href="#" class="btn btn-sm btn-success disabled">Saved</a>`;
        
        loadSavedFiles();

        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => { 
                el.remove(); 
                activeDownloadCount--;
                document.getElementById('activeCount').innerText = activeDownloadCount;
                if(activeDownloadCount === 0) document.getElementById('emptyState').style.display = 'block';
            }, 500);
        }, 3000);
    }
}

function handleError(data) {
     if(cancelledIds.has(data.download_id)) return;
    const el = document.getElementById(`download-${data.download_id}`);
    if (el) {
        el.classList.add('error');
        el.querySelector('.progress-bar').classList.add('bg-danger');
        el.querySelector('.status-text').innerHTML = `<span class="text-danger">Error: ${data.error}</span>`;
        showToast(`Error: ${data.error}`, 'danger');
    }
}

// --- Control Functions ---
function pauseDownload(id) { 
    showConfirm({
        title: 'Pause Download?',
        message: 'Do you want to pause this download temporarily?',
        btnText: 'Pause',
        btnClass: 'btn-warning',
        iconClass: 'bi-pause-circle text-warning'
    }, () => { socket.emit('pause_download', {download_id: id}); });
}

function resumeDownload(id) { socket.emit('resume_download', {download_id: id}); }

function cancelDownload(id) { 
    showConfirm({
        title: 'Cancel Download?',
        message: 'Are you sure? The partial file will be deleted.',
        btnText: 'Cancel Download',
        btnClass: 'btn-danger',
        iconClass: 'bi-x-circle text-danger'
    }, () => {
        cancelledIds.add(id);
        socket.emit('cancel_download', {download_id: id});
        const el = document.getElementById(`download-${id}`);
        if(el) {
            el.remove();
            activeDownloadCount--;
            if(activeDownloadCount < 0) activeDownloadCount = 0;
            document.getElementById('activeCount').innerText = activeDownloadCount;
            if(activeDownloadCount === 0) document.getElementById('emptyState').style.display = 'block';
        }
    });
}

// --- Utilities ---
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function showToast(msg, type='primary') {
    const toastEl = document.getElementById('liveToast');
    const toast = new bootstrap.Toast(toastEl);
    document.getElementById('toastBody').innerText = msg;
    toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.show();
}

async function pasteText(id) {
    try {
        const text = await navigator.clipboard.readText();
        const el = document.getElementById(id);
        el.value = text;
        if(id === 'url') debounceDirectUrl(true);
        if(id === 'gdriveUrl') debounceConvertGDrive(true);
    } catch(e) { showToast('Clipboard access denied or empty', 'warning'); }
}

// --- URL Handling ---
function detectFilename() {
    const url = document.getElementById('url').value;
    const wrapper = document.getElementById('filenamePreviewWrapper');
    const preview = document.getElementById('filenamePreview');
    const displayMode = document.getElementById('previewModeDisplay');
    const input = document.getElementById('customFilename');

    if(!url) {
        if(wrapper) wrapper.style.display = 'none';
        preview.innerText = '';
        return;
    }
    
    fetch('/detect_filename', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url})
    }).then(r => r.json()).then(data => {
        if(data.success) {
            preview.innerText = data.filename;
            wrapper.style.display = 'block';
            displayMode.style.display = 'flex';
            input.style.display = 'none';
            input.value = '';
        }
    });
}

let directUrlDebounceTimer;
function debounceDirectUrl(immediate = false) {
     clearTimeout(directUrlDebounceTimer);
     if(immediate) validateDirectUrl();
     else directUrlDebounceTimer = setTimeout(validateDirectUrl, 800);
}

function validateDirectUrl() {
     const input = document.getElementById('url');
     const url = input.value.trim();
     if(!url) {
         document.getElementById('filenamePreviewWrapper').style.display = 'none';
         return;
     }
     const isUrl = url.match(/^(http|https):\/\/[^ "]+$/);
     if (!isUrl) {
         input.classList.add('shake-invalid');
         setTimeout(() => input.classList.remove('shake-invalid'), 400);
         showToast('Invalid URL', 'warning');
         return;
     }
     detectFilename();
}

let debounceTimer;
function debounceConvertGDrive(immediate = false) {
    clearTimeout(debounceTimer);
    if(immediate) validateAndConvert();
    else debounceTimer = setTimeout(validateAndConvert, 800);
}

function validateAndConvert() {
    const input = document.getElementById('gdriveUrl');
    const url = input.value.trim();
    if (!url) {
        document.getElementById('gdriveResult').style.display = 'none';
        return;
    }
    const isUrl = url.match(/^(http|https):\/\/[^ "]+$/);
    const isGDrive = url.includes('drive.google.com') || url.includes('docs.google.com');

    if (!isUrl || !isGDrive) {
        input.classList.add('shake-invalid');
        setTimeout(() => input.classList.remove('shake-invalid'), 400);
        showToast('Only Google Drive links allowed!', 'warning');
        return;
    }
    // Dummy logic for client-side convert call
    document.getElementById('gdriveLoading').style.display = 'block';
    document.getElementById('gdriveResult').style.display = 'none';
    
    // In a real app this would call the server to resolve the ID
    // For now we just show UI feedback as the actual conversion logic is unused in this specific snippet
    setTimeout(() => {
        document.getElementById('gdriveLoading').style.display = 'none';
        showToast('Ready for manual link copying', 'info');
    }, 500);
}

function copyGDriveLink() {
    const link = document.getElementById('hiddenDirectLink').value;
    if(link) {
        navigator.clipboard.writeText(link).then(() => showToast('Direct Link Copied!', 'success'));
    }
}

// --- FILE LIST & STORAGE LOGIC ---

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if(['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return 'bi-file-earmark-play-fill text-danger';
    if(['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'bi-file-earmark-music-fill text-warning';
    if(['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'bi-file-earmark-image-fill text-primary';
    if(['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'bi-file-earmark-zip-fill text-success';
    return 'bi-file-earmark-fill text-secondary';
}

function isPlayable(filename) {
    const exts = ['.mp4', '.mkv', '.webm', '.ogg', '.mp3', '.wav', '.mov', '.m3u8'];
    return exts.some(ext => filename.toLowerCase().endsWith(ext));
}

function loadSavedFiles() {
    const refreshIcon = document.getElementById('refreshIcon');
    refreshIcon.classList.add('rotate-anim');

    fetch('/list_files')
    .then(r => r.json())
    .then(data => {
        const c = document.getElementById('savedFilesList');
        if(data.files.length === 0) {
             c.innerHTML = '<div class="text-center text-muted p-3">No active downloads finished yet.</div>';
        } else {
            c.innerHTML = data.files.map(f => {
                const iconClass = getFileIcon(f.name);
                const isDrive = f.storage === 'drive';
                
                // --- PASS DRIVE ID TO PLAYER ---
                const playBtn = isPlayable(f.name) ? 
                    `<button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openPlayer('${f.name}', '${f.gdrive_id || ''}')" title="Play Media"><i class="bi bi-play-circle-fill fs-5"></i></button>` : '';
                
                const driveBtn = f.gdrive_link ? 
                    `<a href="${f.gdrive_link}" target="_blank" class="btn btn-sm btn-outline-success border-0 me-1" title="View on Drive"><i class="bi bi-google fs-5"></i></a>` : '';

                const locationIcon = isDrive ? '<i class="bi bi-cloud-check-fill text-info ms-2" title="Stored on Drive"></i>' : '';

                return `
                <div class="card saved-file-card mb-2" id="file-${f.name.replace(/[^a-zA-Z0-9]/g, '')}">
                    <div class="card-body p-2 d-flex align-items-center">
                        <span class="fs-4 me-3"><i class="bi ${iconClass}"></i></span>
                        <div class="overflow-hidden me-auto">
                            <div class="fw-bold text-truncate" title="${f.name}">${f.name} ${locationIcon}</div>
                            <small class="text-muted">${formatBytes(f.size)} • ${f.date}</small>
                        </div>
                        <div class="d-flex align-items-center">
                            ${driveBtn}
                            ${playBtn}
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteFile('${f.name}')" title="Delete File">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`
            }).join('');
        }
        setTimeout(() => { refreshIcon.classList.remove('rotate-anim'); }, 500);
    })
    .catch(e => {
        console.error(e);
        refreshIcon.classList.remove('rotate-anim');
    });
}

function deleteFile(filename) {
    showConfirm({
        title: 'Delete File?',
        message: `Permanently delete "${filename}"?`,
        btnText: 'Delete',
        btnClass: 'btn-danger',
        iconClass: 'bi-trash3 text-danger'
    }, () => {
        const safeId = filename.replace(/[^a-zA-Z0-9]/g, '');
        const el = document.getElementById(`file-${safeId}`);
        if(el) el.style.opacity = '0.5';

        fetch('/delete_file', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({filename: filename})
        })
        .then(r => r.json())
        .then(data => {
            if(data.success) {
                showToast('File deleted', 'success');
                loadSavedFiles(); 
            } else {
                showToast('Delete failed', 'danger');
                if(el) el.style.opacity = '1';
            }
        });
    });
}

// =========================================================
// MX PLAYER LOGIC (Consolidated from test.py)
// =========================================================

const video = document.getElementById('video');
const wrapper = document.getElementById('wrapper');
const progressBg = document.getElementById('progressBg');
const progressFill = document.getElementById('progressFill');
const playBtn = document.getElementById('playBtn');
const muteBtn = document.getElementById('muteBtn');
const volSlider = document.getElementById('volSlider');

let playerModalInstance = null;
let hideTimer;

// 1. Open Player Logic
function openPlayer(filename, driveId = null) {
    const title = document.getElementById('videoTitle');
    title.innerText = filename;

    // --- STREAM SELECTION LOGIC ---
    // If driveId is present, we stream from the Drive proxy
    // If not, we stream from the local filesystem
    let streamUrl;
    if (driveId) {
        streamUrl = `/stream_drive/${driveId}`;
    } else {
        streamUrl = `/stream/${encodeURIComponent(filename)}`;
    }
    
    // Load Video
    video.src = streamUrl;
    
    // Reset Controls
    video.playbackRate = 1.0;
    video.volume = 1.0;
    volSlider.value = 1.0;
    progressFill.style.width = '0%';
    document.getElementById('currTime').innerText = "00:00";
    document.getElementById('durTime').innerText = "00:00";
    
    // Show Modal
    const modalEl = document.getElementById('playerModal');
    playerModalInstance = new bootstrap.Modal(modalEl);
    playerModalInstance.show();

    // Auto Play
    video.play().catch(e => console.log("Autoplay blocked or waiting for interaction", e));
}

function closePlayer() {
    video.pause();
    video.src = ""; // Stop buffering
    if (playerModalInstance) playerModalInstance.hide();
}

// 2. Play / Pause
playBtn.addEventListener('click', () => {
    if (video.paused || video.ended) {
        video.play();
        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
    } else {
        video.pause();
        playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
    }
});

// Update Play Button icon on actual video state change (e.g. if clicked on video to pause)
video.addEventListener('play', () => playBtn.innerHTML = '<i class="bi bi-pause-fill"></i>');
video.addEventListener('pause', () => playBtn.innerHTML = '<i class="bi bi-play-fill"></i>');

// 3. Progress Bar Logic
video.addEventListener('timeupdate', () => {
    if (!isNaN(video.duration)) {
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = pct + '%';
        document.getElementById('currTime').innerText = fmt(video.currentTime);
        document.getElementById('durTime').innerText = fmt(video.duration);
    }
});

progressBg.addEventListener('click', (e) => {
    const rect = progressBg.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
});

function fmt(s) {
    if(isNaN(s)) return "00:00";
    let m = Math.floor(s / 60), sc = Math.floor(s % 60);
    return (m < 10 ? '0' + m : m) + ':' + (sc < 10 ? '0' + sc : sc);
}

// 4. UI Hiding Logic (MX Style)
wrapper.addEventListener('mousemove', () => {
    const controls = document.getElementById('controls');
    const title = document.getElementById('videoTitle');
    
    controls.classList.remove('ui-hidden');
    title.style.opacity = '1';
    wrapper.style.cursor = 'default';
    
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (!video.paused && !document.querySelector('.popup-menu.active')) {
            controls.classList.add('ui-hidden');
            title.style.opacity = '0';
            wrapper.style.cursor = 'none';
        }
    }, 3000);
});

// 5. Volume & Speed
volSlider.addEventListener('input', (e) => {
    video.volume = e.target.value;
    updateMuteIcon();
});

muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    updateMuteIcon();
});

function updateMuteIcon() {
    if (video.muted || video.volume === 0) muteBtn.innerHTML = '<i class="bi bi-volume-mute-fill"></i>';
    else if (video.volume < 0.5) muteBtn.innerHTML = '<i class="bi bi-volume-down-fill"></i>';
    else muteBtn.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
}

function toggleMenu(id) {
    // Hide others
    document.querySelectorAll('.popup-menu').forEach(x => {
        if(x.id !== id) x.classList.remove('active');
    });
    const el = document.getElementById(id);
    if(el) el.classList.toggle('active');
}

function setSpeed(rate, el) {
    video.playbackRate = rate;
    toggleMenu('speedMenu');
    document.querySelectorAll('#speedMenu .menu-opt').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
}

// 6. Fullscreen & PiP
function toggleFullscreen() {
    if (!document.fullscreenElement) wrapper.requestFullscreen();
    else document.exitFullscreen();
}

function togglePiP() {
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else video.requestPictureInPicture().catch(e => showToast('PiP not supported', 'warning'));
}

// Click video to toggle play (except when clicking controls)
video.addEventListener('click', (e) => {
    if(e.target === video) playBtn.click();
});

// Close modal event clean up
document.getElementById('playerModal').addEventListener('hidden.bs.modal', function () {
    closePlayer();
});

// Initialize
loadSavedFiles();
