// Paint Log - Phase 0 skeleton.
// Handles: switching screens, the Settings / Diagnostics screen,
// the camera test, and turning on offline support.

// ---------- Screens ----------
// Each screen is a <section id="screen-NAME">. We show one and hide the rest.

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((section) => {
    section.hidden = section.id !== 'screen-' + name;
  });
  window.scrollTo(0, 0);

  if (name === 'settings') {
    refreshDiagnostics();
  }
  if (name !== 'camera') {
    stopCamera();
  }
}

// Any button with data-go="NAME" opens that screen.
document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => showScreen(button.dataset.go));
});

// ---------- Helpers ----------

function setText(id, text, state) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('ok', 'bad');
  if (state) {
    el.classList.add(state);
  }
}

function toMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------- Storage protection ----------
// Ask the phone to keep our data safe. We do this on every start.
// The answer is kept here so the Settings screen can show it.

let persistResult = 'checking…';

async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    persistResult = 'not supported';
    return;
  }
  try {
    const already = await navigator.storage.persisted();
    const granted = already || await navigator.storage.persist();
    persistResult = granted ? 'yes' : 'no';
  } catch (err) {
    persistResult = 'error: ' + err.name + ' - ' + err.message;
  }
}

// ---------- Settings / Diagnostics ----------

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

async function refreshDiagnostics() {
  const standalone = isStandalone();
  setText('diag-standalone', standalone ? 'yes' : 'no - you are in the browser', standalone ? 'ok' : 'bad');

  setText('diag-persist', persistResult, persistResult === 'yes' ? 'ok' : 'bad');

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      setText('diag-estimate', toMB(est.usage || 0) + ' used of about ' + toMB(est.quota || 0) + ' available');
    } catch (err) {
      setText('diag-estimate', 'error: ' + err.name + ' - ' + err.message, 'bad');
    }
  } else {
    setText('diag-estimate', 'not supported', 'bad');
  }

  if (!('serviceWorker' in navigator)) {
    setText('diag-sw', 'not supported', 'bad');
  } else if (navigator.serviceWorker.controller) {
    setText('diag-sw', 'yes', 'ok');
  } else {
    setText('diag-sw', 'not yet - close and reopen the app', 'bad');
  }

  askVersion();

  // Warn the owner if their data is not safe.
  const warnings = [];
  if (!standalone) {
    warnings.push('You are using the app inside Safari. Data saved here is separate from the home screen app and can be deleted after 7 days. Add the app to your home screen and always open it from the icon.');
  }
  if (persistResult !== 'yes') {
    warnings.push('Storage is not marked as protected. Export a backup regularly (coming in Phase 1).');
  }
  const box = document.getElementById('diag-warning');
  box.hidden = warnings.length === 0;
  box.textContent = warnings.join(' ');
}

// The version number lives in sw.js. Ask the service worker for it.
function askVersion() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('get-version');
  } else {
    setText('diag-version', 'unknown (offline support not active yet)');
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.version) {
      setText('diag-version', event.data.version);
    }
  });
}

// ---------- Camera test ----------

const video = document.getElementById('cam-video');
const canvas = document.getElementById('cam-canvas');
const camResult = document.getElementById('cam-result');
const startBtn = document.getElementById('cam-start');
const snapBtn = document.getElementById('cam-snap');
const stopBtn = document.getElementById('cam-stop');
let cameraStream = null;

function camStatus(text, state) {
  setText('cam-status', text, state);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camStatus('Live camera is not available here. Try the backup method below.', 'bad');
    return;
  }
  camStatus('Asking for camera permission…');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play();
    startBtn.disabled = true;
    snapBtn.disabled = false;
    stopBtn.disabled = false;
    camStatus('Camera is on (' + video.videoWidth + ' × ' + video.videoHeight + ').', 'ok');
  } catch (err) {
    // Show the exact error on screen so it can be reported back.
    camStatus('Camera failed: ' + err.name + ' - ' + err.message, 'bad');
    stopCamera();
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    camStatus('Camera is off.');
  }
  video.srcObject = null;
  startBtn.disabled = false;
  snapBtn.disabled = true;
  stopBtn.disabled = true;
}

function takePhoto() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    camStatus('No picture yet - wait a moment and try again.', 'bad');
    return;
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  camResult.src = canvas.toDataURL('image/jpeg', 0.85);
  camResult.hidden = false;
  camStatus('Photo taken: ' + w + ' × ' + h + ' pixels.', 'ok');
}

startBtn.addEventListener('click', startCamera);
snapBtn.addEventListener('click', takePhoto);
stopBtn.addEventListener('click', stopCamera);

// Turn the camera off when the app goes into the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  }
});

// Backup method: the phone's own photo picker / camera.
const fileInput = document.getElementById('file-input');
const fileResult = document.getElementById('file-result');
let fileUrl = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    return;
  }
  if (fileUrl) {
    URL.revokeObjectURL(fileUrl);
  }
  fileUrl = URL.createObjectURL(file);
  fileResult.onload = () => {
    setText('file-status', 'Got photo: ' + fileResult.naturalWidth + ' × ' + fileResult.naturalHeight +
      ' pixels, ' + toMB(file.size) + '.', 'ok');
  };
  fileResult.src = fileUrl;
  fileResult.hidden = false;
});

// ---------- Start-up ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.error('Service worker failed:', err);
  });
}

requestPersistentStorage().then(() => {
  if (!document.getElementById('screen-settings').hidden) {
    refreshDiagnostics();
  }
});
