// Paint Log - main app logic.
// Handles: choosing which screen to show, the armies and miniatures screens,
// backup, Settings / Diagnostics, the camera test, and offline support.
// The database itself is set up in db.js.

// ---------- Helpers ----------

function $(id) {
  return document.getElementById(id);
}

function setText(id, text, state) {
  const el = $(id);
  el.textContent = text;
  el.classList.remove('ok', 'bad');
  if (state) {
    el.classList.add(state);
  }
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return Math.ceil(bytes / 1024) + ' KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(time) {
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Build an element. Text always goes in as plain text (never as HTML),
// so names with symbols like < or & can't break the page.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function stageBadge(stageKey) {
  return el('span', 'badge stage-' + stageKey, stageLabel(stageKey));
}

// Go to another screen without leaving the current one in the back history
// (used after saving or deleting, so "back" doesn't return to a stale form).
function goTo(hash) {
  location.replace(hash);
}

// ---------- Screens ----------
// The part of the address after '#' decides which screen shows.
// For example '#/army/3' shows army number 3.

const routes = [
  [/^#\/$/, () => showArmies()],
  [/^#\/army\/new$/, () => showArmyForm(null)],
  [/^#\/army\/(\d+)\/edit$/, (m) => showArmyForm(Number(m[1]))],
  [/^#\/army\/(\d+)$/, (m) => showArmy(Number(m[1]))],
  [/^#\/mini\/new\/(\d+)$/, (m) => showMiniForm(null, Number(m[1]))],
  [/^#\/mini\/(\d+)\/edit$/, (m) => showMiniForm(Number(m[1]))],
  [/^#\/mini\/(\d+)$/, (m) => showMini(Number(m[1]))],
  [/^#\/settings$/, () => showSettings()],
  [/^#\/camera$/, () => showScreen('camera')],
];

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((section) => {
    section.hidden = section.id !== 'screen-' + name;
  });
  window.scrollTo(0, 0);
  if (name !== 'camera') {
    stopCamera();
  }
}

async function render() {
  const hash = location.hash || '#/';
  for (const [pattern, show] of routes) {
    const match = hash.match(pattern);
    if (match) {
      try {
        await show(match);
      } catch (err) {
        alert('Something went wrong: ' + err.name + ' - ' + err.message);
      }
      return;
    }
  }
  goTo('#/');
}

window.addEventListener('hashchange', render);

// ---------- Armies list (home) ----------

async function showArmies() {
  const armies = await db.armies.orderBy('createdAt').toArray();
  const list = $('army-list');
  list.replaceChildren();

  for (const army of armies) {
    const minis = await db.miniatures.where('armyId').equals(army.id).toArray();
    const done = minis.filter((m) => m.stage === 'based').length;

    const link = el('a', 'list-item');
    link.href = '#/army/' + army.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', army.name));
    text.append(el('div', 'list-sub', [army.faction, minis.length + ' miniatures', done + ' finished'].filter(Boolean).join(' · ')));
    link.append(text, el('span', 'chevron', '›'));

    const item = el('li');
    item.append(link);
    list.append(item);
  }

  $('army-empty').hidden = armies.length > 0;
  showScreen('armies');
}

// ---------- Army form ----------

let editingArmyId = null;

async function showArmyForm(armyId) {
  editingArmyId = armyId;
  let army = { name: '', faction: '' };
  if (armyId) {
    army = await db.armies.get(armyId);
    if (!army) {
      return goTo('#/');
    }
  }
  $('army-form-title').textContent = armyId ? 'Edit army' : 'New army';
  $('army-form-back').href = armyId ? '#/army/' + armyId : '#/';
  $('army-name').value = army.name;
  $('army-faction').value = army.faction || '';
  showScreen('army-form');
}

$('army-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('army-name').value.trim();
  const faction = $('army-faction').value.trim();
  if (!name) {
    return;
  }
  let id = editingArmyId;
  if (id) {
    await db.armies.update(id, { name, faction });
  } else {
    id = await db.armies.add({ name, faction, createdAt: Date.now() });
  }
  goTo('#/army/' + id);
});

// ---------- One army ----------

let currentArmyId = null;

async function showArmy(armyId) {
  const army = await db.armies.get(armyId);
  if (!army) {
    return goTo('#/');
  }
  currentArmyId = armyId;

  $('army-title').textContent = army.name;
  $('army-faction-text').textContent = army.faction || '';
  $('mini-add').href = '#/mini/new/' + armyId;
  $('army-edit').href = '#/army/' + armyId + '/edit';

  const minis = await db.miniatures.where('armyId').equals(armyId).sortBy('createdAt');

  // Progress summary, e.g. "2 on sprue · 3 primed · 1 based"
  const counts = STAGES
    .map((stage) => ({ label: stage.label, count: minis.filter((m) => m.stage === stage.key).length }))
    .filter((c) => c.count > 0)
    .map((c) => c.count + ' ' + c.label.toLowerCase());
  $('army-progress').textContent = counts.join(' · ');

  const list = $('mini-list');
  list.replaceChildren();
  for (const mini of minis) {
    const link = el('a', 'list-item');
    link.href = '#/mini/' + mini.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', mini.name));
    link.append(text, stageBadge(mini.stage), el('span', 'chevron', '›'));

    const item = el('li');
    item.append(link);
    list.append(item);
  }
  $('mini-empty').hidden = minis.length > 0;
  showScreen('army');
}

$('army-delete').addEventListener('click', async () => {
  const army = await db.armies.get(currentArmyId);
  const count = await db.miniatures.where('armyId').equals(currentArmyId).count();
  if (!army || !confirm('Delete "' + army.name + '" and its ' + count + ' miniatures? This cannot be undone.')) {
    return;
  }
  await deleteArmy(currentArmyId);
  goTo('#/');
});

// ---------- Miniature form ----------

let editingMiniId = null;
let formArmyId = null;

// Fill the stage drop-down once.
for (const stage of STAGES) {
  const option = el('option', '', stage.label);
  option.value = stage.key;
  $('mini-stage').append(option);
}

async function showMiniForm(miniId, armyId) {
  editingMiniId = miniId;
  let mini = { name: '', stage: 'sprue', notes: '', armyId };
  if (miniId) {
    mini = await db.miniatures.get(miniId);
    if (!mini) {
      return goTo('#/');
    }
  }
  formArmyId = mini.armyId;
  if (!(await db.armies.get(formArmyId))) {
    return goTo('#/');
  }
  $('mini-form-title').textContent = miniId ? 'Edit miniature' : 'New miniature';
  $('mini-form-back').href = miniId ? '#/mini/' + miniId : '#/army/' + formArmyId;
  $('mini-name').value = mini.name;
  $('mini-stage').value = mini.stage;
  $('mini-notes').value = mini.notes || '';
  showScreen('mini-form');
}

$('mini-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('mini-name').value.trim();
  const stage = $('mini-stage').value;
  const notes = $('mini-notes').value.trim();
  if (!name) {
    return;
  }
  if (editingMiniId) {
    await db.miniatures.update(editingMiniId, { name, stage, notes });
    goTo('#/mini/' + editingMiniId);
  } else {
    await db.miniatures.add({ armyId: formArmyId, name, stage, notes, createdAt: Date.now() });
    goTo('#/army/' + formArmyId);
  }
});

// ---------- One miniature ----------

let currentMini = null;

async function showMini(miniId) {
  const mini = await db.miniatures.get(miniId);
  if (!mini) {
    return goTo('#/');
  }
  currentMini = mini;
  const army = await db.armies.get(mini.armyId);

  $('mini-back').href = '#/army/' + mini.armyId;
  $('mini-back').textContent = '‹ ' + (army ? army.name : 'Back');
  $('mini-title').textContent = mini.name;
  $('mini-army-text').textContent = 'Added ' + formatDate(mini.createdAt);
  $('mini-edit').href = '#/mini/' + miniId + '/edit';
  $('mini-notes-text').textContent = mini.notes || 'No notes.';

  // Stage bar: one button per stage. Stages already reached are filled in.
  const current = stageIndex(mini.stage);
  const bar = $('stage-bar');
  bar.replaceChildren();
  STAGES.forEach((stage, i) => {
    const button = el('button', 'stage-step', stage.label);
    if (i <= current) {
      button.classList.add('reached');
    }
    if (i === current) {
      button.classList.add('current');
    }
    button.addEventListener('click', () => setStage(stage.key));
    bar.append(button);
  });

  const next = STAGES[current + 1];
  $('stage-next').hidden = !next;
  if (next) {
    $('stage-next').textContent = 'Next stage: ' + next.label + ' →';
  }
  showScreen('mini');
}

async function setStage(stageKey) {
  await db.miniatures.update(currentMini.id, { stage: stageKey });
  await showMini(currentMini.id);
}

$('stage-next').addEventListener('click', () => {
  const next = STAGES[stageIndex(currentMini.stage) + 1];
  if (next) {
    setStage(next.key);
  }
});

$('mini-delete').addEventListener('click', async () => {
  if (!confirm('Delete "' + currentMini.name + '"? This cannot be undone.')) {
    return;
  }
  await deleteMiniatures([currentMini.id]);
  goTo('#/army/' + currentMini.armyId);
});

// ---------- Backup ----------
// Two taps on purpose: the iPhone only opens the Share sheet straight after
// a tap, and making the file can take a moment.

const LAST_BACKUP_KEY = 'paint-log-last-backup';
const BACKUP_REMINDER_DAYS = 14;
let backupFile = null;

function getLastBackup() {
  try {
    return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0;
  } catch (err) {
    return 0;
  }
}

function showLastBackup() {
  const last = getLastBackup();
  const days = (Date.now() - last) / (24 * 60 * 60 * 1000);
  if (!last) {
    setText('backup-last', 'No backup saved yet.', 'bad');
  } else if (days > BACKUP_REMINDER_DAYS) {
    setText('backup-last', 'Last backup: ' + formatDate(last) + '. Time for a new one!', 'bad');
  } else {
    setText('backup-last', 'Last backup: ' + formatDate(last), 'ok');
  }
}

$('backup-create').addEventListener('click', async () => {
  setText('backup-status', 'Creating backup…');
  try {
    const blob = await exportBackup();
    const day = new Date().toISOString().slice(0, 10);
    backupFile = new File([blob], 'paint-log-backup-' + day + '.json', { type: 'application/json' });
    setText('backup-status', 'Backup ready (' + formatSize(blob.size) + '). Tap "Save backup file" and choose "Save to Files".', 'ok');
    $('backup-create').hidden = true;
    $('backup-save').hidden = false;
  } catch (err) {
    setText('backup-status', 'Backup failed: ' + err.name + ' - ' + err.message, 'bad');
  }
});

$('backup-save').addEventListener('click', async () => {
  if (!backupFile) {
    return;
  }
  try {
    if (navigator.canShare && navigator.canShare({ files: [backupFile] })) {
      await navigator.share({ files: [backupFile], title: 'Paint Log backup' });
    } else {
      // Fallback: a normal download.
      const url = URL.createObjectURL(backupFile);
      const link = el('a');
      link.href = url;
      link.download = backupFile.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    try {
      localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
    } catch (err) {
      // Not critical if this can't be remembered.
    }
    setText('backup-status', 'Backup saved.', 'ok');
    resetBackupButtons();
  } catch (err) {
    if (err.name === 'AbortError') {
      setText('backup-status', 'Cancelled. Tap "Save backup file" to try again.');
    } else {
      setText('backup-status', 'Could not save: ' + err.name + ' - ' + err.message, 'bad');
    }
  }
  showLastBackup();
});

function resetBackupButtons() {
  backupFile = null;
  $('backup-create').hidden = false;
  $('backup-save').hidden = true;
}

$('restore-pick').addEventListener('click', () => $('restore-input').click());

$('restore-input').addEventListener('change', async () => {
  const input = $('restore-input');
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) {
    return;
  }
  try {
    setText('restore-status', 'Checking file…');
    const info = await checkBackupFile(file);
    const rows = info.data.tables.reduce((sum, table) => sum + table.rowCount, 0);
    if (!confirm('Restore this backup? It REPLACES ALL data in the app with the ' + rows +
      ' items in the backup. Anything added since the backup was made will be lost.')) {
      setText('restore-status', 'Restore cancelled. Nothing was changed.');
      return;
    }
    setText('restore-status', 'Restoring… keep the app open.');
    await importBackup(file);
    setText('restore-status', 'Restore complete.', 'ok');
  } catch (err) {
    setText('restore-status', 'Restore failed, your data was not changed. ' + err.message, 'bad');
  }
});

// ---------- Storage protection ----------
// Ask the phone to keep our data safe. We do this on every start.

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

function showSettings() {
  showScreen('settings');
  showLastBackup();
  refreshDiagnostics();
}

async function refreshDiagnostics() {
  const standalone = isStandalone();
  setText('diag-standalone', standalone ? 'yes' : 'no - you are in the browser', standalone ? 'ok' : 'bad');

  setText('diag-persist', persistResult, persistResult === 'yes' ? 'ok' : 'bad');

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      setText('diag-estimate', formatSize(est.usage || 0) + ' used of about ' + formatSize(est.quota || 0) + ' available');
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
    warnings.push('You are using the app inside the browser. Data saved here is separate from the home screen app and can be deleted after 7 days. Add the app to your home screen and always open it from the icon.');
  }
  if (persistResult !== 'yes') {
    warnings.push('Storage is not marked as protected. Save a backup regularly.');
  }
  const box = $('diag-warning');
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

const video = $('cam-video');
const canvas = $('cam-canvas');
const camResult = $('cam-result');
const startBtn = $('cam-start');
const snapBtn = $('cam-snap');
const stopBtn = $('cam-stop');
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
const fileInput = $('file-input');
const fileResult = $('file-result');
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
      ' pixels, ' + formatSize(file.size) + '.', 'ok');
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
  if (!$('screen-settings').hidden) {
    refreshDiagnostics();
  }
});

db.open()
  .then(render)
  .catch((err) => {
    document.querySelector('main').textContent =
      'Could not open the database: ' + err.name + ' - ' + err.message;
  });
