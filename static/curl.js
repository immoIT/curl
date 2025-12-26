
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
        if(data.ram < 60) {
            ramBadge.classList.add('bg-success');
        } else if (data.ram < 85) {
            ramBadge.classList.add('bg-warning', 'text-dark');
        } else {
            ramBadge.classList.add('bg-danger');
        }
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
    }, () => {
        socket.emit('pause_download', {download_id: id});
    });
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
            if(activeDownloadCount === 0) {
                document.getElementById('emptyState').style.display = 'block';
            }
        }
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
    } catch(e) { 
        showToast('Clipboard access denied or empty', 'warning'); 
    }
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
     if(immediate) {
         validateDirectUrl();
     } else {
         directUrlDebounceTimer = setTimeout(validateDirectUrl, 800);
     }
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
         input.value = '';
         input.classList.add('shake-invalid');
         setTimeout(() => input.classList.remove('shake-invalid'), 400);
         showToast('Invalid URL', 'warning');
         document.getElementById('filenamePreviewWrapper').style.display = 'none';
         return;
     }
     
     detectFilename();
}

let debounceTimer;
function debounceConvertGDrive(immediate = false) {
    clearTimeout(debounceTimer);
    if(immediate) {
        validateAndConvert();
    } else {
        debounceTimer = setTimeout(validateAndConvert, 800);
    }
}

function validateAndConvert() {
    const input = document.getElementById('gdriveUrl');
    const url = input.value.trim();
    const resultDiv = document.getElementById('gdriveResult');
    const loading = document.getElementById('gdriveLoading');

    if (!url) {
        resultDiv.style.display = 'none';
        loading.style.display = 'none';
        return;
    }

    const isUrl = url.match(/^(http|https):\/\/[^ "]+$/);
    const isGDrive = url.includes('drive.google.com') || url.includes('docs.google.com');

    if (!isUrl || !isGDrive) {
        input.value = '';
        input.classList.add('shake-invalid');
        setTimeout(() => input.classList.remove('shake-invalid'), 400);
        showToast('Only Google Drive links allowed!', 'warning');
        return;
    }
    convertGDriveUrl();
}

function convertGDriveUrl() {
    const url = document.getElementById('gdriveUrl').value.trim();
    const resultDiv = document.getElementById('gdriveResult');
    const loading = document.getElementById('gdriveLoading');
    
    loading.style.display = 'block';
    resultDiv.style.display = 'none';

    fetch('/convert_gdrive_url', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url})
    })
    .then(r => r.json())
    .then(data => {
        loading.style.display = 'none';
        if(data.success && data.direct_url) {
            document.getElementById('hiddenDirectLink').value = data.direct_url;
            document.getElementById('gdriveFilenameDisplay').innerText = data.filename || data.direct_url;
            resultDiv.style.display = 'block';
        } else {
            showToast('Could not convert Drive URL', 'danger');
        }
    })
    .catch(() => {
        loading.style.display = 'none';
        showToast('Conversion Error', 'danger');
    });
}

function copyGDriveLink() {
    const link = document.getElementById('hiddenDirectLink').value;
    if(link) {
        navigator.clipboard.writeText(link).then(() => {
            showToast('Direct Link Copied!', 'success');
        });
    }
}

// --- DOWNLOADED FILES LOGIC ---

// Helper to determine icon class based on file extension
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if(['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return 'bi-file-earmark-play-fill text-danger';
    if(['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'bi-file-earmark-music-fill text-warning';
    if(['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'bi-file-earmark-image-fill text-primary';
    if(['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'bi-file-earmark-zip-fill text-success';
    if(['pdf'].includes(ext)) return 'bi-file-earmark-pdf-fill text-danger';
    if(['txt', 'md', 'json', 'py', 'js', 'html'].includes(ext)) return 'bi-file-earmark-code-fill text-info';
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
                
                // --- MODIFIED PLAY BUTTON LOGIC ---
                // If Playable, play it. Check if it's a Drive file to pass the ID.
                const isDrive = f.storage === 'drive';
                const playBtn = isPlayable(f.name) ? 
                    `<button class="btn btn-sm btn-outline-primary border-0 me-1" onclick="openPlayer('${f.name}', '${f.gdrive_id || ''}')" title="Play Media"><i class="bi bi-play-circle-fill fs-5"></i></button>` : '';
                
                // Drive Link Button
                const driveBtn = f.gdrive_link ? 
                    `<a href="${f.gdrive_link}" target="_blank" class="btn btn-sm btn-outline-success border-0 me-1" title="View on Drive"><i class="bi bi-google fs-5"></i></a>` : 
                    '';

                // Append 'Cloud' icon if stored on Drive
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
                showToast(data.error || 'Delete failed', 'danger');
                if(el) el.style.opacity = '1';
            }
        });
    });
}

// --- PLAYER LOGIC ---
const video = document.getElementById('mediaPlayer');
const container = document.getElementById('videoContainer');
const playBtn = document.getElementById('playPauseBtn');
const progress = document.getElementById('videoProgress');
const currTime = document.getElementById('currTime');
const totalTime = document.getElementById('totalTime');
const volumeSlider = document.getElementById('volumeSlider');
const muteBtn = document.getElementById('muteBtn');
const speedSelect = document.getElementById('playbackRate');
const pipBtn = document.getElementById('pipBtn');
const fullBtn = document.getElementById('fullscreenBtn');

// Audio / Quality Elements
const audioWrapper = document.getElementById('audioTrackWrapper');
const audioBtn = document.getElementById('audioTrackBtn');
const audioList = document.getElementById('audioTracksList');

const qualityWrapper = document.getElementById('qualityMenuWrapper');
const qualityBtn = document.getElementById('qualityBtn');
const qualityList = document.getElementById('qualityList');

video.addEventListener('play', () => {
    playBtn.innerHTML = '<i class="bi bi-pause-fill fs-4"></i>';
    container.classList.remove('paused');
});

video.addEventListener('pause', () => {
    playBtn.innerHTML = '<i class="bi bi-play-fill fs-4"></i>';
    container.classList.add('paused');
});

// --- UPDATED OPEN PLAYER ---
function openPlayer(filename, driveId = null) {
    let streamUrl;
    
    // Determine Source
    if (driveId) {
        // Stream from Drive Proxy
        streamUrl = `/stream_drive/${driveId}`;
    } else {
        // Stream from Local
        streamUrl = `/stream/${encodeURIComponent(filename)}`;
    }
    
    // Reset Menus
    audioWrapper.style.display = 'none';
    audioList.classList.remove('show');
    qualityWrapper.style.display = 'none';
    qualityList.classList.remove('show');
    
    // NATIVE HLS & HLS.js Support
    // Note: HLS.js handles m3u8. Regular mp4/webm works with simple src.
    if (Hls.isSupported() && filename.endsWith('.m3u8')) {
        if (hlsInstance) {
            hlsInstance.destroy();
        }
        hlsInstance = new Hls();
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(video);
        
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
             updateAudioTrackList();
             updateQualityList();
             video.play().catch(e => console.log("Auto-play prevented", e));
        });
        
        hlsInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, updateAudioTrackList);
        hlsInstance.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
             updateQualityList();
        });

    } else if (video.canPlayType('application/vnd.apple.mpegurl') && filename.endsWith('.m3u8')) {
        // Native HLS (Safari)
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function() {
            video.play().catch(e => console.log("Auto-play prevented", e));
        });
    } else {
        // Standard Video (MP4, MKV, etc) - Works for Local and Drive Proxy
        video.src = streamUrl;
        video.play().catch(e => console.log("Auto-play prevented", e));
    }
    
    const modalEl = document.getElementById('playerModal');
    playerModalInstance = new bootstrap.Modal(modalEl);
    playerModalInstance.show();
}

// --- Audio Track Logic ---
function updateAudioTrackList() {
    if (!hlsInstance) return;
    const tracks = hlsInstance.audioTracks;
    
    if (tracks.length < 1) { 
        audioWrapper.style.display = 'none';
        return;
    }

    audioWrapper.style.display = 'block';
    audioList.innerHTML = ''; 
    const langNames = new Intl.DisplayNames(['en'], { type: 'language' });

    tracks.forEach((track, index) => {
        const item = document.createElement('div');
        const isActive = hlsInstance.audioTrack === index;
        item.className = `track-item ${isActive ? 'active' : ''}`;
        
        let label = track.name;
        if (!label && track.lang) {
            try { label = langNames.of(track.lang); } catch (e) { label = track.lang.toUpperCase(); }
        }
        if (!label) label = `Audio ${index + 1}`;
        
        item.textContent = label;
        item.onclick = (e) => {
            e.stopPropagation();
            hlsInstance.audioTrack = index; 
            updateAudioTrackList(); 
            audioList.classList.remove('show'); 
        };
        audioList.appendChild(item);
    });
}

// --- Quality / Resolution Logic ---
function updateQualityList() {
    if (!hlsInstance || !hlsInstance.levels || hlsInstance.levels.length === 0) {
        qualityWrapper.style.display = 'none';
        return;
    }

    qualityWrapper.style.display = 'block';
    qualityList.innerHTML = ''; 

    const currentLevel = hlsInstance.currentLevel; // -1 if Auto
    const autoEnabled = hlsInstance.autoLevelEnabled;
    const actualLevelIdx = hlsInstance.loadLevel; 

    // Add AUTO Option
    const autoItem = document.createElement('div');
    autoItem.className = `track-item ${autoEnabled ? 'active' : ''}`;
    autoItem.innerHTML = `Auto <span style="opacity:0.6; font-size:0.9em;">(${hlsInstance.levels[actualLevelIdx]?.height || '...'}p)</span>`;
    autoItem.onclick = (e) => {
        e.stopPropagation();
        hlsInstance.currentLevel = -1; // Set to Auto
        updateQualityList();
        qualityList.classList.remove('show');
    };
    qualityList.appendChild(autoItem);

    // Add Manual Levels
    hlsInstance.levels.forEach((level, index) => {
        const item = document.createElement('div');
        const isSelected = !autoEnabled && currentLevel === index;
        item.className = `track-item ${isSelected ? 'active' : ''}`;
        
        let label = `${level.height}p`;
        if(level.bitrate) {
            const kbps = Math.round(level.bitrate / 1024);
            label += ` <span style="opacity:0.6; font-size:0.85em;">(${kbps} kbps)</span>`;
        }
        
        item.innerHTML = label;
        item.onclick = (e) => {
            e.stopPropagation();
            hlsInstance.currentLevel = index; 
            updateQualityList(); 
            qualityList.classList.remove('show'); 
        };
        qualityList.appendChild(item);
    });
}

// Menu Toggles
audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    qualityList.classList.remove('show');
    audioList.classList.toggle('show');
});

qualityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    audioList.classList.remove('show');
    qualityList.classList.toggle('show');
});

document.addEventListener('click', (e) => {
    if ((audioList.classList.contains('show') && !audioWrapper.contains(e.target)) ||
        (qualityList.classList.contains('show') && !qualityWrapper.contains(e.target))) {
        audioList.classList.remove('show');
        qualityList.classList.remove('show');
    }
});

function closePlayer() {
    if (playerModalInstance) playerModalInstance.hide();
}

document.getElementById('playerModal').addEventListener('hidden.bs.modal', function () {
    video.pause();
    video.src = "";
    video.currentTime = 0;
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    audioList.classList.remove('show');
    qualityList.classList.remove('show');
});

function togglePlay() {
    if (video.paused || video.ended) {
        video.play();
    } else {
        video.pause();
    }
}

playBtn.addEventListener('click', togglePlay);

video.addEventListener('timeupdate', () => {
    if(!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    progress.value = pct;
    progress.style.background = `linear-gradient(to right, #6366f1 0%, #6366f1 ${pct}%, rgba(255,255,255,0.2) ${pct}%, rgba(255,255,255,0.2) 100%)`;
    currTime.innerText = formatTime(video.currentTime);
    totalTime.innerText = formatTime(video.duration);
});

progress.addEventListener('input', () => {
    const time = (progress.value / 100) * video.duration;
    video.currentTime = time;
});

volumeSlider.addEventListener('input', (e) => {
    video.volume = e.target.value;
    video.muted = false;
    updateVolumeIcon();
});

muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    updateVolumeIcon();
});

function updateVolumeIcon() {
    if(video.muted || video.volume === 0) {
        muteBtn.innerHTML = '<i class="bi bi-volume-mute-fill"></i>';
    } else if (video.volume < 0.5) {
        muteBtn.innerHTML = '<i class="bi bi-volume-down-fill"></i>';
    } else {
        muteBtn.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
    }
}

speedSelect.addEventListener('change', (e) => {
    video.playbackRate = parseFloat(e.target.value);
});

fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen();
});

pipBtn.addEventListener('click', async () => {
     try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
     } catch(e) { showToast('PiP not supported', 'warning'); }
});

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0'+s : s}`;
}

loadSavedFiles();
