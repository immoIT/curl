// - Consolidated Client Logic

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
                <button class="btn btn-sm btn-outline-warning btn-pause" onclick="pauseDownload('${data.download_id}')" title="Pause"><i class="bi bi-pause-fill"></i></button>
                <button class="btn btn-sm btn-outline-success btn-resume" onclick="resumeDownload('${data.download_id}')" title="Resume" style="display:none;"><i class="bi bi-play-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="cancelDownload('${data.download_id}')" title="Cancel"><i class="bi bi-x-lg"></i></button>
            </div>
        </div>
        <div class="progress"><div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div></div>
        <div class="download-meta d-flex justify-content-between">
            <span><i class="bi bi-hdd me-1"></i><span class="downloaded">0/0</span></span>
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

// ... (Other standard handlers: handleError, handlePaused, pause/resume/cancelDownload, formatBytes, showToast, pasteText, detectFilename, etc. - assume standard implementations) ...

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
                // Pass Drive ID to openPlayer if available
                const isDrive = f.storage === 'drive';
                const playBtn = `<button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openPlayer('${f.name}', '${f.gdrive_id || ''}')"><i class="bi bi-play-circle-fill fs-5"></i></button>`;
                const driveBtn = f.gdrive_link ? `<a href="${f.gdrive_link}" target="_blank" class="btn btn-sm btn-outline-success border-0 me-1"><i class="bi bi-google fs-5"></i></a>` : '';
                
                return `
                <div class="card saved-file-card mb-2" id="file-${f.name.replace(/[^a-zA-Z0-9]/g, '')}">
                    <div class="card-body p-2 d-flex align-items-center">
                        <span class="fs-4 me-3"><i class="bi bi-file-earmark-play-fill text-danger"></i></span>
                        <div class="overflow-hidden me-auto">
                            <div class="fw-bold text-truncate" title="${f.name}">${f.name}</div>
                            <small class="text-muted">${formatBytes(f.size)} • ${f.date}</small>
                        </div>
                        <div class="d-flex align-items-center">
                            ${driveBtn}
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
// 2. MX PLAYER CONTROLLER LOGIC (Ported from test.py)
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

let playerModalInstance = null;
let hideTimer;
let isPortrait = false;
let zoomIdx = 0;
const zoomModes = ['contain', 'cover', 'fill'];
const zoomIcons = ['fa-expand', 'fa-crop-alt', 'fa-arrows-alt-h'];

// --- 1. Startup & Teardown ---

function openPlayer(filename, driveId = null) {
    videoTitle.innerText = filename;

    // Use Drive Proxy if ID exists, else local stream
    let streamUrl = driveId ? `/stream_drive/${driveId}` : `/stream/${encodeURIComponent(filename)}`;
    video.src = streamUrl;
    
    // Reset State
    video.playbackRate = 1.0;
    video.volume = 1.0;
    volSlider.value = 1.0;
    progressFill.style.width = '0%';
    document.getElementById('currTime').innerText = "00:00";
    document.getElementById('durTime').innerText = "00:00";
    
    // Reset Transforms
    isPortrait = false;
    rotator.style.transform = "rotate(0deg)";
    rotator.style.width = "100%"; rotator.style.height = "100%";
    rotator.style.position = "relative";
    rotator.style.marginTop = "0"; rotator.style.marginLeft = "0";
    video.style.objectFit = 'contain';
    
    const modalEl = document.getElementById('playerModal');
    playerModalInstance = new bootstrap.Modal(modalEl);
    playerModalInstance.show();

    video.play().catch(e => console.log("Autoplay blocked", e));
}

function closePlayer() {
    video.pause();
    video.src = "";
    if (playerModalInstance) playerModalInstance.hide();
}

// --- 2. Menu & UI Toggles ---

function toggleMenu(id) {
    // Hide all other menus first
    document.querySelectorAll('.popup-menu').forEach(x => {
        if(x.id !== id) x.classList.remove('active');
    });
    // Toggle requested menu
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
    // Note: True quality switching requires HLS levels or separate files.
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

// --- 3. Subtitle Logic (Matches test.py) ---

async function loadExistingSubs() {
    try {
        const res = await fetch('/get_subs'); // Assumes backend endpoint exists
        const subs = await res.json();
        const container = document.getElementById('subListContainer');
        
        // Reset list
        container.innerHTML = '<div class="menu-opt selected" onclick="toggleSub(false, this)">Off</div>';
        
        if (Array.isArray(subs)) {
            subs.forEach(sub => addSubToMenu(sub.name, sub.id));
        }
    } catch (e) { console.error("Error fetching subs", e); }
}

function addSubToMenu(name, fileId) {
    // 1. Create Track Element
    const track = document.createElement("track");
    track.kind = "captions"; 
    track.label = name; 
    track.src = "/stream_drive/" + fileId; // Stream subs from Drive
    track.srclang = "en"; 
    video.appendChild(track);
    
    // 2. Add Menu Option
    const div = document.createElement('div');
    div.className = 'menu-opt'; 
    div.innerText = name;
    div.onclick = function() {
        // Toggle Tracks
        for(let i=0; i<video.textTracks.length; i++) {
            if(video.textTracks[i].label === name) video.textTracks[i].mode = 'showing';
            else video.textTracks[i].mode = 'hidden';
        }
        // Update UI
        document.querySelectorAll('#subListContainer .menu-opt').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        toggleMenu('subMenu');
    };
    
    // Insert after "Off" button
    const container = document.getElementById('subListContainer');
    if (container.children.length > 0) {
        container.insertBefore(div, container.children[1]); 
    } else {
        container.appendChild(div);
    }
}

// Handle File Upload
document.getElementById('subFileInput').addEventListener('change', async function() {
    if(this.files[0]) {
        const file = this.files[0];
        const formData = new FormData(); 
        formData.append('file', file);
        
        try {
            // Show loading state
            const label = document.querySelector('label[for="subFileInput"]');
            const originalText = label.innerHTML;
            label.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
            
            const res = await fetch('/upload_sub', { method: 'POST', body: formData });
            const data = await res.json();
            
            if(data.success) {
                // Clear old tracks to prevent sync issues
                video.querySelectorAll('track').forEach(t => t.remove());
                
                const container = document.getElementById('subListContainer');
                container.innerHTML = '<div class="menu-opt selected" onclick="toggleSub(false, this)">Off</div>';
                
                addSubToMenu(data.name, data.file_id);
                
                // Automatically select the new subtitle
                if(container.children[1]) container.children[1].click();
                
            } else { showToast("Upload failed: " + data.error, 'danger'); }
            
            label.innerHTML = originalText;
        } catch(e) { 
            showToast("Error uploading subtitle", 'danger'); 
        } finally { 
            toggleMenu('subMenu'); 
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
    controls.classList.remove('ui-hidden');
    videoTitle.classList.remove('ui-hidden'); 
    wrapper.style.cursor = "default";
    
    clearTimeout(hideTimer);
    
    // Auto-hide if playing and no menu is open
    if (!video.paused && !document.querySelector('.popup-menu.active')) {
        hideTimer = setTimeout(() => {
            controls.classList.add('ui-hidden');
            videoTitle.classList.add('ui-hidden'); 
            wrapper.style.cursor = "none";
        }, 3000);
    }
}

// Show controls on interaction
wrapper.addEventListener('mousemove', showControls);
wrapper.addEventListener('click', (e) => {
    // Don't trigger if clicking a button or menu
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
        clearTimeout(hideTimer); 
        controls.classList.remove('ui-hidden'); 
    }
});

// Click video to toggle play
video.addEventListener('click', (e) => {
    if(e.target === video) playBtn.click();
});

// Progress Bar
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

// Cleanup on modal close
document.getElementById('playerModal').addEventListener('hidden.bs.modal', function () {
    closePlayer();
});

