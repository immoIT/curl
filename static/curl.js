// - Complete Client Logic

// =========================================================
// 1. DASHBOARD & SOCKET LOGIC
// =========================================================

// --- Theme Toggle ---
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

// --- Socket.IO Setup ---
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

// --- Server Stats ---
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

// --- Download Events ---
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
    
    const statusText = el.querySelector('.status-text');
    const metaIcon = el.querySelector('.meta-icon');

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
                <button class="btn btn-sm btn-outline-warning btn-pause" onclick="pauseDownload('${data.download_id}')" title="Pause"><i class="bi bi-pause-fill"></i></button>
                <button class="btn btn-sm btn-outline-success btn-resume" onclick="resumeDownload('${data.download_id}')" title="Resume" style="display:none;"><i class="bi bi-play-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="cancelDownload('${data.download_id}')" title="Cancel"><i class="bi bi-x-lg"></i></button>
            </div>
        </div>
        <div class="progress"><div class="progress-bar" role="progressbar" style="width: 0%"></div></div>
        <div class="download-meta d-flex justify-content-between">
            <span><i class="bi bi-hdd me-1 meta-icon"></i><span class="downloaded">0/0</span></span>
            <span><i class="bi bi-speedometer2 me-1"></i><span class="speed">0 B/s</span></span>
            <span><i class="bi bi-clock me-1"></i><span class="eta">--</span></span>
            <span class="fw-bold percent text-primary">0%</span>
        </div>`;
    return div;
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

// --- CONFIRM MODAL LOGIC ---
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
    document.getElementById('gdriveLoading').style.display = 'block';
    document.getElementById('gdriveResult').style.display = 'none';
    
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

// --- File List Logic ---
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
                const playBtn = `<button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openPlayer('${f.name}', '${f.gdrive_id || ''}')"><i class="bi bi-play-circle-fill fs-5"></i></button>`;
                const downloadBtn = f.gdrive_id ? `<a href="/download_drive/${f.gdrive_id}" class="btn btn-sm btn-outline-success border-0 me-1"><i class="bi bi-cloud-download fs-5"></i></a>` : '';
                
                return `
                <div class="card saved-file-card mb-2" id="file-${f.name.replace(/[^a-zA-Z0-9]/g, '')}">
                    <div class="card-body p-2 d-flex align-items-center">
                        <span class="fs-4 me-3"><i class="bi bi-file-earmark-play-fill text-danger"></i></span>
                        <div class="overflow-hidden me-auto">
                            <div class="fw-bold text-truncate" title="${f.name}">${f.name}</div>
                            <small class="text-muted">${formatBytes(f.size)} • ${f.date}</small>
                        </div>
                        <div class="d-flex align-items-center">
                            ${downloadBtn}
                            ${playBtn}
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteFile('${f.name}')"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>`
            }).join('');
        }
        setTimeout(() => { refreshIcon.classList.remove('rotate-anim'); }, 500);
    });
}

// =========================================================
// 2. MX PLAYER CONTROLLER LOGIC
// =========================================================

const video = document.getElementById('video');
const wrapper = document.getElementById('wrapper');
const rotator = document.getElementById('rotator');
const controls = document.getElementById('controls');
const videoTitle = document.getElementById('videoTitle');
const playBtn = document.getElementById('playBtn');
const progressBg = document.getElementById('progressBg');
const progressFill = document.getElementById('progressFill');
const spinner = document.getElementById('bufferingIcon');
const zoomIcon = document.getElementById('zoomIcon');
const speedBtn = document.getElementById('speedBtn');
const qualityBtn = document.getElementById('qualityBtn');
const fsBtn = document.getElementById('fsBtn');
const volSlider = document.getElementById('volSlider');
const muteBtn = document.getElementById('muteBtn');
const closePlayerBtn = document.getElementById('closePlayerBtn'); // Get close button

let playerModalInstance = null;
let hideTimer;
let isPortrait = false;
let zoomIdx = 0;
const zoomModes = ['contain', 'cover', 'fill'];
const zoomIcons = ['fa-expand', 'fa-crop-alt', 'fa-arrows-alt-h'];

// --- 1. Startup & Teardown ---

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
    isPortrait = false;
    rotator.style.transform = "rotate(0deg)";
    rotator.style.width = "100%"; rotator.style.height = "100%";
    rotator.style.position = "relative";
    rotator.style.marginTop = "0"; rotator.style.marginLeft = "0";
    video.style.objectFit = 'contain';
    const modalEl = document.getElementById('playerModal');
    playerModalInstance = new bootstrap.Modal(modalEl);
    playerModalInstance.show();
    video.play().then(() => {
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    }).catch(e => console.log("Autoplay blocked", e));
}

function closePlayer() {
    video.pause();
    video.src = "";
    if (playerModalInstance) playerModalInstance.hide();
}

// --- 2. Menu & UI Toggles ---

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

function setQuality(qual, el) {
    toggleMenu('qualityMenu');
    document.querySelectorAll('#qualityMenu .menu-opt').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    if (qual === 'original') qualityBtn.innerHTML = '<span class="btn-text">HD</span>';
    else qualityBtn.innerHTML = '<span class="btn-text">' + qual + '</span>';
}

function cycleZoom() {
    zoomIdx = (zoomIdx + 1) % zoomModes.length;
    video.style.objectFit = zoomModes[zoomIdx];
    zoomIcon.className = 'fas ' + zoomIcons[zoomIdx];
}

function toggleRotation() {
    isPortrait = !isPortrait;
    if (isPortrait) {
        if (wrapper.requestFullscreen) wrapper.requestFullscreen();
        rotator.style.transform = "rotate(90deg)";
        rotator.style.width = "100vh"; rotator.style.height = "100vw";
        rotator.style.position = "absolute";
        rotator.style.top = "50%"; rotator.style.left = "50%";
        rotator.style.marginTop = "-50vw"; rotator.style.marginLeft = "-50vh";
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        rotator.style.transform = "rotate(0deg)";
        rotator.style.width = "100%"; rotator.style.height = "100%";
        rotator.style.position = "relative";
        rotator.style.marginTop = "0"; rotator.style.marginLeft = "0";
        rotator.style.top = "0"; rotator.style.left = "0";
    }
}

async function togglePiP() {
    try {
        if (video !== document.pictureInPictureElement) await video.requestPictureInPicture();
        else await document.exitPictureInPicture();
    } catch(e) { showToast('PiP not supported', 'warning'); }
}

// --- 3. Subtitle Logic ---

async function loadExistingSubs() {
    try {
        const res = await fetch('/get_subs'); 
        const subs = await res.json();
        const container = document.getElementById('subListContainer');
        container.innerHTML = '<div class="menu-opt selected" onclick="toggleSub(false, this)">Off</div>';
        if (Array.isArray(subs)) {
            subs.forEach(sub => addSubToMenu(sub.name, sub.id));
        }
    } catch (e) { console.error("Error fetching subs", e); }
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
    const container = document.getElementById('subListContainer');
    if (container.children.length > 0) {
        container.insertBefore(div, container.children[1]); 
    } else {
        container.appendChild(div);
    }
}

document.getElementById('subFileInput').addEventListener('change', async function() {
    if(this.files[0]) {
        const file = this.files[0];
        const formData = new FormData(); 
        formData.append('file', file);
        try {
            const label = document.querySelector('label[for="subFileInput"]');
            const originalText = label.innerHTML;
            label.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
            const res = await fetch('/upload_sub', { method: 'POST', body: formData });
            const data = await res.json();
            if(data.success) {
                video.querySelectorAll('track').forEach(t => t.remove());
                const container = document.getElementById('subListContainer');
                container.innerHTML = '<div class="menu-opt selected" onclick="toggleSub(false, this)">Off</div>';
                addSubToMenu(data.name, data.file_id);
                if(container.children[1]) container.children[1].click();
            } else { showToast("Upload failed: " + data.error, 'danger'); }
            label.innerHTML = originalText;
        } catch(e) { showToast("Error uploading subtitle", 'danger'); } finally { toggleMenu('subMenu'); }
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

// --- 4. Audio Tracks ---
function loadAudioTracks() {
    const menu = document.getElementById('audioMenu');
    if (video.audioTracks && video.audioTracks.length > 0) {
        menu.innerHTML = ''; 
        for (let i = 0; i < video.audioTracks.length; i++) {
            const track = video.audioTracks[i];
            const label = track.label || track.language || `Track ${i + 1}`;
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

// --- 5. Core Event Listeners ---

video.addEventListener('loadedmetadata', () => { 
    loadAudioTracks(); 
    loadExistingSubs(); 
});

function showControls() {
    // Show everything
    controls.classList.remove('ui-hidden');
    videoTitle.classList.remove('ui-hidden');
    if(closePlayerBtn) closePlayerBtn.classList.remove('ui-hidden'); // Show close button
    
    wrapper.style.cursor = "default";
    clearTimeout(hideTimer);
    
    // Only auto-hide if playing and no menu is active
    if (!video.paused && !document.querySelector('.popup-menu.active')) {
        hideTimer = setTimeout(() => {
            controls.classList.add('ui-hidden');
            videoTitle.classList.add('ui-hidden');
            if(closePlayerBtn) closePlayerBtn.classList.add('ui-hidden'); // Hide close button
            wrapper.style.cursor = "none";
        }, 3000);
    }
}

wrapper.addEventListener('mousemove', showControls);
wrapper.addEventListener('click', (e) => {
    if(!e.target.closest('button') && !e.target.closest('.popup-menu') && !e.target.closest('.progress-bg')) {
        showControls();
    }
});

playBtn.addEventListener('click', () => {
    if (video.paused) { 
        video.play(); 
        playBtn.innerHTML = '<i class="fas fa-pause"></i>'; 
        showControls(); 
    } else { 
        video.pause(); 
        playBtn.innerHTML = '<i class="fas fa-play"></i>'; 
        // Pause means show controls permanently (clear timer)
        clearTimeout(hideTimer); 
        controls.classList.remove('ui-hidden'); 
        videoTitle.classList.remove('ui-hidden');
        if(closePlayerBtn) closePlayerBtn.classList.remove('ui-hidden');
    }
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

fsBtn.addEventListener('click', () => { 
    if (isPortrait) toggleRotation(); 
    else { 
        (!document.fullscreenElement) ? wrapper.requestFullscreen() : document.exitFullscreen(); 
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
