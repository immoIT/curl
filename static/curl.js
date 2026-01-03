// =========================================================
// 1. THEME CONFIGURATION
// =========================================================

const DEFAULT_THEME_URL = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css";
const themeLink = document.getElementById('themeStylesheet');

// =========================================================
// 2. DASHBOARD & SOCKET LOGIC
// =========================================================

const toggle = document.getElementById('darkModeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeSelect = document.getElementById('themeSelector');
const applyThemeBtn = document.getElementById('applyThemeBtn');
const themeLoader = document.getElementById('themeLoader');

function updateThemeIcon(isDark) {
    if(themeIcon) themeIcon.className = isDark ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
}

const currentDarkMode = localStorage.getItem('themeMode'); 
if (currentDarkMode === 'dark') {
    if(toggle) toggle.checked = true;
    updateThemeIcon(true);
} else {
    updateThemeIcon(false);
}

const currentThemeName = localStorage.getItem('themeName') || 'default';
if(themeSelect) themeSelect.value = currentThemeName;

if(toggle) {
    toggle.addEventListener('change', () => {
        const isDark = toggle.checked;
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('themeMode', isDark ? 'dark' : 'light');
        updateThemeIcon(isDark);
    });
}

if(applyThemeBtn && themeSelect) {
    applyThemeBtn.addEventListener('click', () => {
        const themeName = themeSelect.value;
        const modalEl = document.getElementById('settingsModal');
        if(modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        if(themeName === localStorage.getItem('themeName')) return;
        if(themeLoader) themeLoader.classList.remove('d-none');
        
        let newUrl = DEFAULT_THEME_URL;
        if (themeName !== 'default') {
            newUrl = `https://cdn.jsdelivr.net/npm/bootswatch@5.3.2/dist/${themeName}/bootstrap.min.css`;
        }

        const safetyTimer = setTimeout(() => { if(themeLoader) themeLoader.classList.add('d-none'); }, 5000);
        themeLink.href = newUrl;
        localStorage.setItem('themeName', themeName);
        themeLink.onload = () => {
            clearTimeout(safetyTimer);
            setTimeout(() => { if(themeLoader) themeLoader.classList.add('d-none'); }, 600);
        };
        themeLink.onerror = () => {
            clearTimeout(safetyTimer);
            if(themeLoader) themeLoader.classList.add('d-none');
            alert("Failed to download theme.");
        };
    });
}

const socket = io({
    transports: ['websocket'],
    upgrade: false
});
let activeDownloadCount = 0;
const cancelledIds = new Set();
const ytAbortControllers = new Map(); // Store AbortControllers for YouTube downloads

socket.on('connect', () => {
    const status = document.getElementById('connectionStatus');
    if(status) {
        status.className = 'badge bg-success';
        status.innerHTML = '<i class="bi bi-wifi"></i> Connected';
    }
    const ad = document.getElementById('activeDownloads');
    if(ad) {
        ad.innerHTML = `
            <div id="emptyState" class="text-center py-5 text-muted opacity-50 border rounded-3 border-dashed bg-body-tertiary">
                <i class="bi bi-cloud-download display-1"></i><p class="mt-3">No active downloads running</p>
            </div>`;
    }
    activeDownloadCount = 0;
    const ac = document.getElementById('activeCount');
    if(ac) ac.innerText = 0;
    loadSavedFiles();
});

socket.on('disconnect', () => {
    const status = document.getElementById('connectionStatus');
    if(status) {
        status.className = 'badge bg-danger';
        status.innerHTML = '<i class="bi bi-wifi-off"></i> Offline';
    }
});

socket.on('download_progress', (data) => updateDownloadUI(data));
socket.on('download_complete', (data) => handleComplete(data));
socket.on('download_error', (data) => handleError(data));
socket.on('download_paused', (data) => handlePaused(data));

// --- DIRECT DOWNLOAD FORM ---
if(document.getElementById('downloadForm')) {
    document.getElementById('downloadForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const url = document.getElementById('url').value.trim();
        const custom = document.getElementById('customFilename').value.trim();
        const mode = custom ? 'custom' : 'original';
        if(!url) return showToast('Please enter a URL', 'danger');
        
        showActiveDownloads();
        socket.emit('start_download', {
            url: url,
            filename_mode: mode,
            custom_filename: custom,
            mode: 'direct'
        });
        showToast('Download started', 'primary');
        document.getElementById('url').value = '';
        document.getElementById('customFilename').value = '';
        document.getElementById('filenamePreviewWrapper').style.display = 'none';
    });
}

// =========================================================
// UPDATED YOUTUBE LOGIC (Client-Side Streaming)
// =========================================================
const ytForm = document.getElementById('ytSearchForm');
if(ytForm) {
    ytForm.addEventListener('submit', (e) => {
        e.preventDefault();
        fetchYoutubeInfo();
    });
}

function fetchYoutubeInfo() {
    const url = document.getElementById('ytUrl').value;
    const loading = document.getElementById('ytLoading');
    const infoArea = document.getElementById('ytInfoArea');
    const fetchBtn = document.getElementById('ytFetchBtn');

    if(!url) return showToast('Please enter a YouTube URL', 'warning');

    loading.classList.remove('d-none');
    infoArea.classList.add('d-none');
    fetchBtn.disabled = true;

    fetch('/youtube/fetch_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            document.getElementById('ytThumb').src = data.thumbnail;
            document.getElementById('ytTitle').innerText = data.title;
            document.getElementById('ytDur').innerText = data.duration;
            
            const qualityList = document.getElementById('ytQualities');
            qualityList.innerHTML = '';
            
            if(data.formats.length === 0) {
                 qualityList.innerHTML = '<div class="text-muted p-2">No suitable formats found.</div>';
            } else {
                data.formats.forEach(f => {
                    const btn = document.createElement('button');
                    btn.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
                    btn.innerHTML = `<span><i class="bi bi-film me-2"></i>${f.res}</span>
                                     <span class="badge bg-primary rounded-pill">${f.size}</span>`;
                    
                    // FIXED: Logic to handle visibility on click
                    btn.onclick = () => {
                        hideActiveDownloads(); // Ensure it's hidden during the server-side download phase
                        showYtLine();          // Start the thin line animation
                        performYoutubeDownload(url, f.res);
                    };
                    qualityList.appendChild(btn);
                });
            }
            
            infoArea.classList.remove('d-none');
        } else {
            showToast("Error: " + data.error, 'danger');
        }
    })
    .catch(err => showToast("Fetch failed: " + err.message, 'danger'))
    .finally(() => {
        loading.classList.add('d-none');
        fetchBtn.disabled = false;
    });
}

async function performYoutubeDownload(url, resolution) {
    try {
        const res = await fetch('/youtube/download_and_upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, resolution })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

    } catch (e) {
        hideYtLine();
        showToast(e.message, 'danger');
    }
}

function showYtLine() {
    document.getElementById('ytThinProgress')?.classList.remove('d-none');
}

function hideYtLine() {
    document.getElementById('ytThinProgress')?.classList.add('d-none');
}

function formatTimeSeconds(seconds) {
    if (!seconds || seconds < 0) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// =========================================================
// UI HELPERS
// =========================================================

function createDownloadItem(data) {
    const div = document.createElement('div');
    div.id = `download-${data.download_id}`;
    div.className = 'download-item';
    div.setAttribute('data-phase', 'downloading'); 
    div.innerHTML = `
        <div class="download-header-row">
            <div class="download-info-col">
                <h6 class="filename fw-bold mb-0 text-truncate" style="max-width: 100%;">${data.filename}</h6>
                <small class="text-muted status-text">Downloading...</small>
            </div>
            <div class="download-btn-col">
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-warning btn-pause" onclick="pauseDownload('${data.download_id}')" title="Pause"><i class="bi bi-pause-fill"></i></button>
                    <button class="btn btn-sm btn-outline-success btn-resume" onclick="resumeDownload('${data.download_id}')" title="Resume" style="display:none;"><i class="bi bi-play-fill"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="cancelDownload('${data.download_id}')" title="Cancel"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
        </div>
        <div class="progress"><div class="progress-bar" role="progressbar" style="width: 0%"></div></div>
        <div class="download-meta d-flex justify-content-between">
            <span><i class="bi bi-hdd me-1 meta-icon"></i><span class="downloaded">0/0</span></span>
            <span class="d-none d-sm-inline"><i class="bi bi-speedometer2 me-1"></i><span class="speed">0 B/s</span></span>
            <span><i class="bi bi-clock me-1"></i><span class="eta">--</span></span>
            <span class="fw-bold percent text-primary">0%</span>
        </div>`;
    return div;
}

function updateDownloadUI(data) {
    // FIXED: Show Active Downloads only when YT upload starts
    if (data.download_id.startsWith('yt_') && data.phase === 'uploading') {
        hideYtLine();            
        showActiveDownloads();   
    }

    if(cancelledIds.has(data.download_id)) return;
    const container = document.getElementById('activeDownloads');
    let el = document.getElementById(`download-${data.download_id}`);
    const emptyState = document.getElementById('emptyState');
    if(emptyState) emptyState.style.display = 'none';
    
    if (!el) {
        el = createDownloadItem(data);
        container.prepend(el);
        activeDownloadCount++;
        document.getElementById('activeCount').innerText = activeDownloadCount;
        
        // Hide pause/resume for YT downloads as we don't support pause on streams yet
        if (data.download_id.startsWith('yt_')) {
            el.querySelector('.btn-pause').style.display = 'none';
        }
    } else {
        el.classList.remove('paused', 'error');
        
        const pauseBtn = el.querySelector('.btn-pause');
        const resumeBtn = el.querySelector('.btn-resume');
        
        if (!data.download_id.startsWith('yt_')) {
            if(pauseBtn && !el.classList.contains('paused')) pauseBtn.style.display = 'inline-block';
            if(resumeBtn) resumeBtn.style.display = 'none';
        }
    }

    const bar = el.querySelector('.progress-bar');
    bar.style.width = `${data.percentage}%`;
    const statusText = el.querySelector('.status-text');
    const metaIcon = el.querySelector('.meta-icon');
    el.setAttribute('data-phase', data.phase);

    if (data.phase === 'uploading') {
        bar.classList.add('progress-bar-striped', 'progress-bar-animated');
        bar.classList.remove('bg-primary');
        bar.classList.add('bg-info');
        statusText.innerHTML = '<span class="text-info"><i class="bi bi-cloud-upload"></i> Uploading...</span>';
        metaIcon.className = 'bi bi-cloud-upload me-1 meta-icon';
        const pauseBtn = el.querySelector('.btn-pause');
        if(pauseBtn) pauseBtn.style.display = 'none';
    } else {
        bar.classList.remove('bg-info', 'progress-bar-striped', 'progress-bar-animated');
        bar.classList.add('bg-primary');
        statusText.innerHTML = 'Downloading...';
        metaIcon.className = 'bi bi-hdd me-1 meta-icon';
    }
    
    el.querySelector('.filename').innerText = data.filename;
    el.querySelector('.percent').innerText = `${data.percentage.toFixed(1)}%`;
    el.querySelector('.speed').innerText = data.speed;
    el.querySelector('.eta').innerText = data.eta;
    
    const downloadedStr = formatBytes(data.downloaded);
    const totalStr = (data.total_size && data.total_size > 0) ? formatBytes(data.total_size) : '...';
    
    const sizeDisplay = el.querySelector('.downloaded');
    if (sizeDisplay) {
        sizeDisplay.innerText = `${downloadedStr} / ${totalStr}`;
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
        
        // Only reload server files if it wasn't a local YT download
        if (!data.download_id.startsWith('yt_')) {
            loadSavedFiles();
        }
        
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
                el.remove();
                activeDownloadCount--;
                if (activeDownloadCount < 0) activeDownloadCount = 0;
                document.getElementById('activeCount').innerText = activeDownloadCount;

                if (activeDownloadCount === 0) {
                    const es = document.getElementById('emptyState');
                    if (es) es.style.display = 'block';
                }

                // FIXED: Hide Active Downloads section again if it was a YouTube task
                if (data.download_id.startsWith('yt_')) {
                    hideActiveDownloads();
                }
            }, 500);
        }, 3000);
    }
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

function enableEditMode() {
    const previewText = document.getElementById('filenamePreview').innerText;
    const input = document.getElementById('customFilename');
    const displayMode = document.getElementById('previewModeDisplay');
    input.value = previewText;
    displayMode.style.display = 'none';
    input.style.display = 'block';
    input.focus();
}

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
    const el = document.getElementById(`download-${id}`);
    const isUploading = el && el.getAttribute('data-phase') === 'uploading';
    const isYoutube = id.startsWith('yt_');
    
    let title, msg, btnText;
    
    if (isYoutube) {
        title = 'Cancel Stream?';
        msg = 'Stop streaming from YouTube?';
        btnText = 'Stop';
    } else {
        title = isUploading ? 'Cancel Uploading?' : 'Cancel Download?';
        msg = isUploading 
            ? 'Stop uploading to Google Drive? The file will be lost.' 
            : 'Are you sure? The partial file will be deleted.';
        btnText = isUploading ? 'Cancel Upload' : 'Cancel Download';
    }

    showConfirm({
        title: title,
        message: msg,
        btnText: btnText,
        btnClass: 'btn-danger',
        iconClass: 'bi-x-circle text-danger'
    }, () => {
        cancelledIds.add(id);
        
        if (isYoutube) {
            // Client-side abort
            if(ytAbortControllers.has(id)) {
                ytAbortControllers.get(id).abort();
                ytAbortControllers.delete(id);
            }
        } else {
            // Server-side emit
            socket.emit('cancel_download', {download_id: id});
        }
        
        if(el) {
            el.remove();
            activeDownloadCount--;
            if(activeDownloadCount < 0) activeDownloadCount = 0;
            document.getElementById('activeCount').innerText = activeDownloadCount;
            if(activeDownloadCount === 0) {
                const es = document.getElementById('emptyState');
                if(es) es.style.display = 'block';
            }
        }
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
    const resultDiv = document.getElementById('gdriveResult');
    
    if (!url) {
        resultDiv.style.display = 'none';
        return;
    }

    let fileId = null;
    const patterns = [/\/file\/d\/([^/]+)/, /id=([^&]+)/, /\/open\?id=([^&]+)/];
    for (let p of patterns) {
        let m = url.match(p);
        if (m) { fileId = m[1]; break; }
    }

    if (!fileId) {
        input.classList.add('shake-invalid');
        setTimeout(() => input.classList.remove('shake-invalid'), 400);
        showToast('Invalid Google Drive Link', 'warning');
        resultDiv.style.display = 'none';
        return;
    }

    const directLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
    document.getElementById('gdriveFilenameDisplay').innerText = directLink;
    document.getElementById('hiddenDirectLink').value = directLink;
    resultDiv.style.display = 'block';
}

function copyGDriveLink() {
    const link = document.getElementById('hiddenDirectLink').value;
    if(link) {
        navigator.clipboard.writeText(link).then(() => showToast('Direct Link Copied!', 'success'));
    }
}

// =========================================================
// UPDATED LIBRARY LOGIC
// =========================================================

function getFileIcon(filename) {
    if (!filename) return 'bi-file-earmark-fill text-secondary';
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'zip': 'bi-file-earmark-zip-fill text-warning',
        'rar': 'bi-file-earmark-zip-fill text-warning',
        '7z': 'bi-file-earmark-zip-fill text-warning',
        'tar': 'bi-file-earmark-zip-fill text-warning',
        'gz':  'bi-file-earmark-zip-fill text-warning',
        'bz2': 'bi-file-earmark-zip-fill text-warning',
        'mp4': 'bi-file-earmark-play-fill text-danger',
        'mkv': 'bi-file-earmark-play-fill text-danger',
        'webm':'bi-file-earmark-play-fill text-danger',
        'mov': 'bi-file-earmark-play-fill text-danger',
        'avi': 'bi-file-earmark-play-fill text-danger',
        'm4v': 'bi-file-earmark-play-fill text-danger',
        'mp3': 'bi-file-earmark-music-fill text-info',
        'wav': 'bi-file-earmark-music-fill text-info',
        'm4a': 'bi-file-earmark-music-fill text-info',
        'flac':'bi-file-earmark-music-fill text-info',
        'aac': 'bi-file-earmark-music-fill text-info',
        'doc': 'bi-file-earmark-word-fill text-primary',
        'docx':'bi-file-earmark-word-fill text-primary',
        'pdf': 'bi-file-earmark-pdf-fill text-danger',
        'xls': 'bi-file-earmark-excel-fill text-success',
        'xlsx':'bi-file-earmark-excel-fill text-success',
        'ppt': 'bi-file-earmark-ppt-fill text-warning',
        'pptx':'bi-file-earmark-ppt-fill text-warning',
        'txt': 'bi-file-earmark-text-fill text-secondary',
        'jpg': 'bi-file-earmark-image-fill text-success',
        'jpeg':'bi-file-earmark-image-fill text-success',
        'png': 'bi-file-earmark-image-fill text-success',
        'gif': 'bi-file-earmark-image-fill text-success',
        'webp':'bi-file-earmark-image-fill text-success',
        'py': 'bi-file-earmark-code-fill text-primary',
        'js': 'bi-file-earmark-code-fill text-warning',
        'html':'bi-file-earmark-code-fill text-danger',
        'css': 'bi-file-earmark-code-fill text-info'
    };
    return iconMap[ext] || 'bi-file-earmark-fill text-secondary';
}

function isVideo(filename) {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'].includes(ext);
}

function loadSavedFiles() {
    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon) refreshIcon.classList.add('rotate-anim');

    fetch('/list_files')
    .then(r => r.json())
    .then(data => {
        const c = document.getElementById('savedFilesList');
        if(!c) return;

        if(data.files.length === 0) {
             c.innerHTML = '<div class="text-center text-muted p-3">No active downloads finished yet.</div>';
        } else {
            c.innerHTML = data.files.map(f => {
                const iconClass = getFileIcon(f.name);
                const showPlay = isVideo(f.name);
                
                const playBtn = showPlay ? 
                    `<button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openPlayer('${f.name}', '${f.gdrive_id || ''}')" title="Play Video"><i class="bi bi-play-circle-fill fs-5"></i></button>` 
                    : '';

                const downloadBtn = f.gdrive_id ? 
                    `<a href="/download_drive/${f.gdrive_id}" class="btn btn-sm btn-outline-success border-0 me-1" title="Download"><i class="bi bi-cloud-download fs-5"></i></a>` 
                    : '';

                return `
                <div class="card saved-file-card mb-2" id="file-${f.name.replace(/[^a-zA-Z0-9]/g, '')}">
                    <div class="card-body p-2 d-flex align-items-center">
                        <span class="fs-4 me-3"><i class="bi ${iconClass}"></i></span>
                        <div class="overflow-hidden me-auto">
                            <div class="fw-bold text-truncate" title="${f.name}">${f.name}</div>
                            <small class="text-muted">${formatBytes(f.size)} • ${f.date}</small>
                        </div>
                        <div class="d-flex align-items-center">
                            ${downloadBtn}
                            ${playBtn}
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteFile('${f.name}')" title="Delete"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
        setTimeout(() => { 
            if(refreshIcon) refreshIcon.classList.remove('rotate-anim'); 
        }, 500);
    });
}

// =========================================================
// 3. PLAYER CONTROLLER LOGIC
// =========================================================

const video = document.getElementById('video');
const wrapper = document.getElementById('wrapper');
const rotator = document.getElementById('rotator');
const controls = document.getElementById('controls');
const videoTitle = document.getElementById('videoTitle');
const centerPlayBtn = document.getElementById('centerPlayBtn');

const progressBg = document.getElementById('progressBg');
const progressFill = document.getElementById('progressFill');
const zoomIcon = document.getElementById('zoomIcon');
const zoomBtn = document.getElementById('zoomBtn'); 
const speedBtn = document.getElementById('speedBtn');
const qualityBtn = document.getElementById('qualityBtn');
const volSlider = document.getElementById('volSlider');
const muteBtn = document.getElementById('muteBtn');
const closePlayerBtn = document.getElementById('closePlayerBtn');

let playerModalInstance = null;
let hideTimer;
let isOverlay = false; 
let zoomIdx = 0;
let subOffset = 0; 

const zoomModes = ['contain', 'fill', 'cover', 'smart-crop']; 
const zoomIcons = ['fa-expand', 'fa-arrows-alt-h', 'fa-compress-arrows-alt', 'fa-crop'];

function openPlayer(filename, driveId = null) {
    videoTitle.innerText = filename;
    let streamUrl = driveId ? `/stream_drive/${driveId}` : `/stream/${encodeURIComponent(filename)}`;
    video.src = streamUrl;
    video.playbackRate = 1.0;
    video.volume = 1.0;
    volSlider.value = 1.0;
    progressFill.style.width = '0%';
    document.getElementById('currTime').innerText = "00:00";
    document.getElementById('durTime').innerText = "00:00";
    
    toggleOverlay(false); // Reset to normal mode on open
    zoomIdx = 0;
    video.style.objectFit = 'contain';
    video.style.transform = ''; 
    if(zoomBtn) zoomBtn.style.display = 'none'; 
    if(zoomIcon) zoomIcon.className = 'fas fa-expand';
    
    subOffset = 0;
    if(centerPlayBtn) centerPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
    
    if(qualityBtn) {
        qualityBtn.innerHTML = '<span class="btn-text">--</span>';
        qualityBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); }; 
    }
    const menu = document.getElementById('qualityMenu');
    if(menu) menu.innerHTML = '';

    if (driveId) {
        fetch(`/video_meta/${driveId}`)
            .then(r => r.json())
            .then(data => {
                if (data.width && data.height) {
                    const h = parseInt(data.height);
                    let badge = 'HD';
                    if (h >= 2160) badge = '4K';
                    else if (h >= 1440) badge = '2K';
                    else if (h >= 1080) badge = '1080p';
                    else if (h >= 720) badge = '720p';
                    else badge = h + 'p';
                    if(qualityBtn) qualityBtn.innerHTML = `<span class="btn-text">${badge}</span>`;
                }
            })
            .catch(e => console.log('Meta fetch error', e));
    }

    const modalEl = document.getElementById('playerModal');
    playerModalInstance = new bootstrap.Modal(modalEl);
    playerModalInstance.show();
    video.play().then(() => {
        if(centerPlayBtn) centerPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
        showControls(); 
    }).catch(e => console.log("Autoplay blocked", e));
}

function closePlayer() {
    video.pause();
    video.src = "";
    if (playerModalInstance) playerModalInstance.hide();
}

function toggleMenu(id) {
    document.querySelectorAll('.popup-menu').forEach(x => {
        if(x.id !== id) x.classList.remove('active');
    });
    const el = document.getElementById(id);
    if(el) el.classList.toggle('active');
}

function setSpeed(rate, el) {
    video.playbackRate = rate;
    toggleMenu('speedMenu');
    document.querySelectorAll('#speedMenu .menu-opt').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    if (rate === 1.0) speedBtn.innerHTML = '<i class="fas fa-tachometer-alt"></i>';
    else speedBtn.innerHTML = '<span class="btn-text">' + rate + 'x</span>';
}

function setQuality(qual, el) { }

function cycleZoom() {
    if (!isOverlay) return; 
    zoomIdx = (zoomIdx + 1) % zoomModes.length;
    const mode = zoomModes[zoomIdx];
    
    // Reset transform before applying new mode
    video.style.transform = ''; 
    
    if (mode === 'smart-crop') {
        video.style.objectFit = 'cover'; 
        video.style.transform = 'scale(1.2)'; 
    } else {
        video.style.objectFit = mode;
    }
    
    if(zoomIcon) zoomIcon.className = 'fas ' + zoomIcons[zoomIdx];
    showToast('Zoom: ' + mode, 'primary');
}

function toggleOverlay(active) {
    isOverlay = active;
    const dialog = document.querySelector('#playerModal .modal-dialog');
    const content = document.querySelector('#playerModal .modal-content');

    if (isOverlay) {
        // 1. Force Browser Fullscreen
        if (wrapper.requestFullscreen) {
            wrapper.requestFullscreen().catch(err => console.log("Fullscreen blocked:", err));
        } else if (wrapper.webkitRequestFullscreen) { /* Safari */
            wrapper.webkitRequestFullscreen();
        }

        // 2. CSS Overlay (Escaping the Modal)
        if(dialog) {
            dialog.style.setProperty('transform', 'none', 'important');
            dialog.style.setProperty('max-width', 'none', 'important');
            dialog.style.setProperty('margin', '0', 'important');
            dialog.style.setProperty('transition', 'none', 'important'); 
        }
        if(content) {
             content.style.setProperty('border', 'none', 'important');
             content.style.setProperty('background', 'black', 'important'); 
             content.style.setProperty('height', '100vh', 'important');
        }

        // 3. Wrapper Styles - Fill Screen (No Rotation)
        wrapper.style.setProperty('position', 'fixed', 'important');
        wrapper.style.setProperty('top', '0', 'important');
        wrapper.style.setProperty('left', '0', 'important');
        wrapper.style.setProperty('width', '100vw', 'important');
        wrapper.style.setProperty('height', '100vh', 'important');
        wrapper.style.setProperty('z-index', '9999', 'important');
        wrapper.style.borderRadius = '0';

        // Ensure rotator container is neutral
        rotator.style.width = "100%"; 
        rotator.style.height = "100%";
        rotator.style.transform = "none"; 
        
        // Show Zoom button
        if(zoomBtn) zoomBtn.style.display = 'inline-block';
        
        // Update Icon
        fsBtn.innerHTML = '<i class="fas fa-compress"></i>';

    } else {
        // Exit Browser Fullscreen
        if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen && document.webkitFullscreenElement) {
            document.webkitExitFullscreen();
        }

        // Reset Modal Styles
        if(dialog) {
            dialog.style.removeProperty('transform');
            dialog.style.removeProperty('max-width');
            dialog.style.removeProperty('margin');
            dialog.style.removeProperty('transition');
        }
        if(content) {
             content.style.removeProperty('border');
             content.style.removeProperty('background'); 
             content.style.removeProperty('height');
        }

        // Reset Wrapper Styles
        wrapper.style.position = '';
        wrapper.style.top = '';
        wrapper.style.left = '';
        wrapper.style.width = '';
        wrapper.style.height = '';
        wrapper.style.zIndex = '';
        wrapper.style.borderRadius = ''; 

        // Reset Rotator
        rotator.style.transform = "";
        
        if(zoomBtn) zoomBtn.style.display = 'none';
        fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
}

async function togglePiP() {
    try {
        if (video !== document.pictureInPictureElement) await video.requestPictureInPicture();
        else await document.exitPictureInPicture();
    } catch(e) { showToast('PiP not supported', 'warning'); }
}

async function loadExistingSubs() {
    try {
        const res = await fetch('/get_subs'); 
        const subs = await res.json();
        buildSubMenu(subs);
    } catch (e) { console.error("Error fetching subs", e); }
}

function adjustSubOffset(amount) {
    subOffset += amount;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].mode === 'showing') {
            const cues = tracks[i].cues;
            if(cues) {
                for (let j = 0; j < cues.length; j++) {
                    cues[j].startTime += amount;
                    cues[j].endTime += amount;
                }
            }
        }
    }
    showToast(`Sync: ${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)}s`, 'primary');
}

function buildSubMenu(subs) {
    const container = document.getElementById('subListContainer');
    const syncControls = `
        <div class="d-flex justify-content-between px-2 py-1 mb-2 border-bottom border-secondary">
            <button class="btn btn-sm btn-outline-light py-0 px-2" onclick="adjustSubOffset(-0.5)" title="Delay -0.5s">-0.5s</button>
            <span class="small text-muted align-self-center">Sync</span>
            <button class="btn btn-sm btn-outline-light py-0 px-2" onclick="adjustSubOffset(0.5)" title="Delay +0.5s">+0.5s</button>
        </div>
        <div class="menu-opt selected" onclick="toggleSub(false, this)">Off</div>
    `;
    container.innerHTML = syncControls;
    if (Array.isArray(subs)) {
        subs.forEach(sub => addSubToMenu(sub.name, sub.id));
    }
}

function addSubToMenu(name, fileId) {
    const track = document.createElement("track");
    track.kind = "captions"; 
    track.label = name; 
    track.src = "/stream_drive/" + fileId; 
    track.srclang = "en"; 
    video.appendChild(track);
    
    const div = document.createElement('div');
    div.className = 'menu-opt'; 
    div.innerText = name;
    div.onclick = function() {
        for(let i=0; i<video.textTracks.length; i++) {
            if(video.textTracks[i].label === name) video.textTracks[i].mode = 'showing';
            else video.textTracks[i].mode = 'hidden';
        }
        document.querySelectorAll('#subListContainer .menu-opt').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        toggleMenu('subMenu');
    };
    document.getElementById('subListContainer').appendChild(div);
}

document.getElementById('subFileInput').addEventListener('change', async function() {
    const wasOverlay = isOverlay; 
    if(this.files[0]) {
        const file = this.files[0];
        const formData = new FormData(); 
        formData.append('file', file);
        try {
            const label = document.querySelector('label[for="subFileInput"]');
            const originalText = label.innerHTML;
            label.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
            const res = await fetch('/upload_sub', { method: 'POST', body: formData });
            const text = await res.text(); console.log(text);
            if(data.success) {
                video.querySelectorAll('track').forEach(t => t.remove());
                buildSubMenu([{name: data.name, id: data.file_id}]);
                const newOpt = document.getElementById('subListContainer').lastElementChild;
                if(newOpt) newOpt.click();
            } else { showToast("Upload failed: " + data.error, 'danger'); }
            label.innerHTML = originalText;
        } catch(e) { showToast("Error uploading subtitle", 'danger'); } finally { 
            toggleMenu('subMenu'); 
            // Restore overlay state if needed
            if (wasOverlay) toggleOverlay(true);
        }
    }
});

function toggleSub(enable, el) {
    for(let i=0; i<video.textTracks.length; i++) video.textTracks[i].mode = 'hidden';
    if(el) {
        document.querySelectorAll('#subListContainer .menu-opt').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
    }
    toggleMenu('subMenu');
}

function loadAudioTracks() {
    const menu = document.getElementById('audioMenu');
    if (video.audioTracks && video.audioTracks.length > 0) {
        menu.innerHTML = ''; 
        for (let i = 0; i < video.audioTracks.length; i++) {
            const track = video.audioTracks[i];
            let lang = (track.language || '').toLowerCase();
            let label = track.label || lang || `Track ${i + 1}`;
            
            const div = document.createElement('div');
            div.className = 'menu-opt';
            if (track.enabled) div.classList.add('selected');
            div.innerText = label;
            div.onclick = function() {
                for (let j = 0; j < video.audioTracks.length; j++) video.audioTracks[j].enabled = false;
                track.enabled = true;
                document.querySelectorAll('#audioMenu .menu-opt').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                toggleMenu('audioMenu'); 
            };
            menu.appendChild(div);
        }
    } else { 
        menu.innerHTML = '<div class="menu-opt" style="color:#666">Default (Stereo)</div>'; 
    }
}

video.addEventListener('loadedmetadata', () => { 
    loadAudioTracks(); 
    loadExistingSubs(); 
});

function showControls() {
    controls.classList.remove('ui-hidden');
    videoTitle.classList.remove('ui-hidden');
    if(centerPlayBtn) centerPlayBtn.classList.remove('ui-hidden');
    if(closePlayerBtn) closePlayerBtn.classList.remove('ui-hidden');
    
    wrapper.style.cursor = "default";
    clearTimeout(hideTimer);
    
    if (!video.paused && !document.querySelector('.popup-menu.active')) {
        hideTimer = setTimeout(() => {
            controls.classList.add('ui-hidden');
            videoTitle.classList.add('ui-hidden');
            if(centerPlayBtn) centerPlayBtn.classList.add('ui-hidden');
            if(closePlayerBtn) closePlayerBtn.classList.add('ui-hidden');
            wrapper.style.cursor = "none";
        }, 3000);
    }
}

controls.addEventListener('click', () => showControls());

wrapper.addEventListener('mousemove', showControls);
wrapper.addEventListener('click', (e) => {
    if(!e.target.closest('button') && !e.target.closest('.popup-menu') && !e.target.closest('.progress-bg')) {
        showControls();
    }
});

function togglePlayPause() {
    if (video.paused) { 
        video.play(); 
        if(centerPlayBtn) centerPlayBtn.innerHTML = '<i class="fas fa-pause"></i>'; 
        showControls(); 
    } else { 
        video.pause(); 
        if(centerPlayBtn) centerPlayBtn.innerHTML = '<i class="fas fa-play"></i>'; 
        clearTimeout(hideTimer); 
        controls.classList.remove('ui-hidden'); 
        videoTitle.classList.remove('ui-hidden');
        if(centerPlayBtn) centerPlayBtn.classList.remove('ui-hidden');
        if(closePlayerBtn) closePlayerBtn.classList.remove('ui-hidden');
    }
}

if(centerPlayBtn) {
    centerPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        togglePlayPause();
    });
}

video.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPause();
});

progressBg.addEventListener('click', (e) => {
    const rect = progressBg.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
});

video.addEventListener('timeupdate', () => {
    if (!isNaN(video.duration)) {
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = pct + '%';
        document.getElementById('currTime').innerText = fmt(video.currentTime);
        document.getElementById('durTime').innerText = fmt(video.duration);
    }
});

function fmt(s) { 
    if(isNaN(s)) return "00:00"; 
    let m = Math.floor(s/60), sc = Math.floor(s%60); 
    return (m<10?'0'+m:m) + ':' + (sc<10?'0'+sc:sc); 
}

const fsBtn = document.getElementById('fsBtn');
if(fsBtn) {
    fsBtn.addEventListener('click', (e) => { 
        e.stopPropagation();
        toggleOverlay(!isOverlay); 
    });
}

// Add escape key listener to exit overlay
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOverlay) {
        toggleOverlay(false);
    }
});

// Sync with browser fullscreen changes (e.g. if user presses Esc)
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isOverlay) {
        toggleOverlay(false);
    }
});

volSlider.addEventListener('input', (e) => { video.volume = e.target.value; });

muteBtn.addEventListener('click', () => { 
    video.muted = !video.muted;
    if(video.muted) muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
    else muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
});

document.getElementById('playerModal').addEventListener('hidden.bs.modal', function () {
    closePlayer();
});


// =========================================================
// 4. SIDEBAR NAVIGATION LOGIC
// =========================================================

function switchView(viewName, navElement) {
    const sections = {
        direct: document.getElementById('section-direct'),
        drive: document.getElementById('section-drive'),
        youtube: document.getElementById('section-youtube')
    };
    const activeSection = document.getElementById('activeDownloadsSection');
    const breadcrumb = document.getElementById('breadcrumbCurrent');
    
    // 1. Update active states in Sidebar
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(el => el.classList.remove('active'));
    if (navElement) navElement.classList.add('active');

    // 2. Reset all sections: Hide them and clear layout classes
    Object.values(sections).forEach(el => {
        if (el) {
            el.classList.add('d-none'); // Hide section
            el.classList.remove('col-12', 'col-lg-6', 'mt-3', 'mt-lg-0'); // Clear layout
        }
    });

    // 3. Apply Specific Layout Logic
    if (viewName === 'dashboard') {
        // Show both Direct and Drive side-by-side
        sections.direct.classList.remove('d-none');
        sections.direct.classList.add('col-lg-6');
        
        sections.drive.classList.remove('d-none');
        sections.drive.classList.add('col-lg-6', 'mt-3', 'mt-lg-0');
        
        // Always show Active Downloads on Dashboard if there are downloads
        if (activeDownloadCount > 0) showActiveDownloads();
        
        if (breadcrumb) breadcrumb.innerText = 'Dashboard';
    } else {
        // Show only the selected section at full width
        const target = sections[viewName];
        if (target) {
            target.classList.remove('d-none');
            target.classList.add('col-12');
            
            // FIXED: Hide active downloads when entering a specific tool view
            // It will reappear automatically via updateDownloadUI when a download/upload starts
            hideActiveDownloads();

            if (breadcrumb) {
                breadcrumb.innerText = viewName.charAt(0).toUpperCase() + 
                                     viewName.slice(1) + ' Downloader';
            }
        }
    }

    // 4. Handle Mobile Sidebar Auto-close
    const sidebar = document.getElementById('sidebarMenu');
    if (sidebar && window.innerWidth < 768) {
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(sidebar);
        if (bsOffcanvas) bsOffcanvas.hide();
    }
}



window.addEventListener('popstate', (event) => {
    if (event.state && event.state.view) {
        switchView(event.state.view, null); 
    } else {
        const path = window.location.pathname;
        if(path.includes('direct')) switchView('direct', null);
        else if(path.includes('drive')) switchView('drive', null);
        else if(path.includes('youtube')) switchView('youtube', null);
        else switchView('dashboard', null);
    }
});

function hideActiveDownloads() {
    document.getElementById('activeDownloadsSection')?.classList.add('d-none');
}

function showActiveDownloads() {
    document.getElementById('activeDownloadsSection')?.classList.remove('d-none');
}
nnerText = 'YouTube Downloader';
    }

    const sidebar = document.getElementById('sidebarMenu');
    if (sidebar && window.innerWidth < 768) {
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(sidebar);
        if (bsOffcanvas) bsOffcanvas.hide();
    }
}

window.addEventListener('popstate', (event) => {
    if (event.state && event.state.view) {
        switchView(event.state.view, null); 
    } else {
        const path = window.location.pathname;
        if(path.includes('direct')) switchView('direct', null);
        else if(path.includes('drive')) switchView('drive', null);
        else if(path.includes('youtube')) switchView('youtube', null);
        else switchView('dashboard', null);
    }
});
