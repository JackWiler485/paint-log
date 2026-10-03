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
    const models = minis.reduce((sum, m) => sum + modelCountOf(m), 0);
    const done = minis.reduce((sum, m) => sum + (stageCountsOf(m).based || 0), 0);

    const link = el('a', 'list-item');
    link.href = '#/army/' + army.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', army.name));
    text.append(el('div', 'list-sub', [army.faction, plural(models, 'model'), done + ' finished'].filter(Boolean).join(' · ')));
    link.append(text, el('span', 'chevron', '›'));

    const item = el('li');
    item.append(link);
    list.append(item);
  }

  $('army-empty').hidden = armies.length > 0;
  showScreen('armies');
}

function plural(count, word) {
  return count + ' ' + word + (count === 1 ? '' : 's');
}

// "2 on sprue · 3 primed"
function describeCounts(counts) {
  return STAGES
    .filter((stage) => counts[stage.key] > 0)
    .map((stage) => counts[stage.key] + ' ' + stage.label.toLowerCase())
    .join(' · ');
}

// ---------- Army form ----------

let editingArmy = null;

async function showArmyForm(armyId) {
  let army = { name: '', faction: '', factionId: '' };
  if (armyId) {
    army = await db.armies.get(armyId);
    if (!army) {
      return goTo('#/');
    }
  }
  editingArmy = army;
  $('army-form-title').textContent = armyId ? 'Edit army' : 'New army';
  $('army-form-back').href = armyId ? '#/army/' + armyId : '#/';
  $('army-name').value = army.name;

  // Fill the faction list from the unit catalogue.
  const select = $('army-faction');
  const none = el('option', '', 'Other / not listed');
  none.value = '';
  select.replaceChildren(none);
  let note = '';
  try {
    for (const choice of await factionChoices()) {
      const option = el('option', '', choice.name);
      option.value = choice.id;
      select.append(option);
    }
  } catch (err) {
    note = 'The faction list could not be loaded: ' + err.message;
  }
  select.value = army.factionId || '';
  if (!note && army.faction && !army.factionId) {
    note = 'Previously typed: "' + army.faction + '". Pick the matching faction to search its units when adding miniatures.';
  }
  $('army-faction-note').textContent = note;
  $('army-faction-note').hidden = !note;
  showScreen('army-form');
}

$('army-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('army-name').value.trim();
  if (!name) {
    return;
  }
  const select = $('army-faction');
  const factionId = select.value;
  // With no faction picked, keep any faction typed in an older version.
  const faction = factionId ? select.options[select.selectedIndex].text : (editingArmy.factionId ? '' : editingArmy.faction || '');

  let id = editingArmy.id;
  if (id) {
    await db.armies.update(id, { name, faction, factionId });
  } else {
    id = await db.armies.add({ name, faction, factionId, createdAt: Date.now() });
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

  // Progress summary over all models, e.g. "12 models: 2 on sprue · 10 primed"
  const totals = {};
  for (const mini of minis) {
    for (const [stage, count] of Object.entries(stageCountsOf(mini))) {
      totals[stage] = (totals[stage] || 0) + count;
    }
  }
  const modelTotal = Object.values(totals).reduce((sum, n) => sum + n, 0);
  $('army-progress').textContent = modelTotal ? plural(modelTotal, 'model') + ': ' + describeCounts(totals) : '';

  const list = $('mini-list');
  list.replaceChildren();
  for (const mini of minis) {
    const link = el('a', 'list-item');
    link.href = '#/mini/' + mini.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', mini.name));
    const models = modelCountOf(mini);
    if (models > 1) {
      const counts = stageCountsOf(mini);
      const mixed = Object.keys(counts).length > 1;
      text.append(el('div', 'list-sub', plural(models, 'model') + (mixed ? ' · ' + describeCounts(counts) : '')));
    }
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

let editingMini = null;
let formArmyId = null;
let formUnits = [];
let pickedUnitName = null;

const MAX_RESULTS = 50;

// Fill the stage drop-down once.
for (const stage of STAGES) {
  const option = el('option', '', stage.label);
  option.value = stage.key;
  $('mini-stage').append(option);
}

async function showMiniForm(miniId, armyId) {
  let mini = { name: '', stage: 'sprue', notes: '', armyId, models: 1 };
  if (miniId) {
    mini = await db.miniatures.get(miniId);
    if (!mini) {
      return goTo('#/');
    }
  }
  const army = await db.armies.get(mini.armyId);
  if (!army) {
    return goTo('#/');
  }
  editingMini = miniId ? mini : null;
  formArmyId = mini.armyId;
  pickedUnitName = mini.unitName || null;

  $('mini-form-title').textContent = miniId ? 'Edit miniature' : 'New miniature';
  $('mini-form-back').href = miniId ? '#/mini/' + miniId : '#/army/' + formArmyId;
  $('mini-name').value = mini.name;
  $('mini-models').value = modelCountOf(mini);
  $('mini-stage').value = mini.stage;
  $('mini-notes').value = mini.notes || '';

  // The stage is only asked for new entries; after that it is set on the miniature screen.
  $('mini-stage-label').hidden = Boolean(miniId);

  // Unit search, only when adding to an army with a faction from the list.
  $('unit-search').value = '';
  $('unit-results').replaceChildren();
  formUnits = [];
  let offNote = '';
  if (!miniId) {
    if (army.factionId) {
      try {
        formUnits = await unitsForFaction(army.factionId);
      } catch (err) {
        offNote = 'The unit list could not be loaded: ' + err.message;
      }
    } else {
      offNote = 'Tip: pick a faction for this army (Edit army) to search its units here.';
    }
  }
  $('unit-search-box').hidden = formUnits.length === 0;
  $('unit-search-note').textContent = 'Search ' + formUnits.length + ' ' + (army.faction || '') + ' units, or type a name below.';
  $('unit-search-off').textContent = offNote;
  $('unit-search-off').hidden = !offNote;
  showScreen('mini-form');
}

$('unit-search').addEventListener('input', () => {
  const query = $('unit-search').value.trim();
  const list = $('unit-results');
  list.replaceChildren();
  if (!query) {
    $('unit-search-note').textContent = 'Search ' + formUnits.length + ' units, or type a name below.';
    return;
  }
  const found = searchUnits(formUnits, query);
  for (const unit of found.slice(0, MAX_RESULTS)) {
    const button = el('button', 'list-item unit-result');
    button.type = 'button';
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', unit.name));
    text.append(el('div', 'list-sub', [describeSizes(unit.sizes), unit.group].filter(Boolean).join(' · ')));
    button.append(text);
    if (unit.legends) {
      button.append(el('span', 'badge legends', 'Legends'));
    }
    button.addEventListener('click', () => pickUnit(unit));
    const item = el('li');
    item.append(button);
    list.append(item);
  }
  let note = found.length === 0 ? 'No units match. You can type the name yourself below.' : '';
  if (found.length > MAX_RESULTS) {
    note = 'Showing ' + MAX_RESULTS + ' of ' + found.length + '. Keep typing to narrow it down.';
  }
  $('unit-search-note').textContent = note;
});

// The keyboard's Search/Enter key must not save the form.
// If exactly one unit matches, pick it; otherwise just close the keyboard.
$('unit-search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const query = $('unit-search').value.trim();
  const found = query ? searchUnits(formUnits, query) : [];
  if (found.length === 1) {
    pickUnit(found[0]);
  } else {
    $('unit-search').blur();
  }
});

function pickUnit(unit) {
  pickedUnitName = unit.name;
  $('mini-name').value = unit.name;
  $('mini-models').value = (unit.sizes && unit.sizes[0]) || 1;
  $('unit-search').value = '';
  $('unit-results').replaceChildren();
  $('unit-search-note').textContent = 'Picked "' + unit.name + '" (' + describeSizes(unit.sizes) + '). Change the number of models if needed.';
  $('unit-search').blur();
  $('mini-name').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

$('mini-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('mini-name').value.trim();
  const models = Math.round(Number($('mini-models').value));
  const notes = $('mini-notes').value.trim();
  if (!name || !(models >= 1)) {
    return;
  }
  // Remember the catalogue unit only while the name still matches it.
  const unitName = pickedUnitName === name ? pickedUnitName : null;

  if (editingMini) {
    const counts = resizeCounts(stageCountsOf(editingMini), models);
    await db.miniatures.update(editingMini.id, { name, notes, unitName, ...squadFields(counts) });
    goTo('#/mini/' + editingMini.id);
  } else {
    const counts = { [$('mini-stage').value]: models };
    await db.miniatures.add({ armyId: formArmyId, name, notes, unitName, ...squadFields(counts), createdAt: Date.now() });
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
  const counts = stageCountsOf(mini);
  const models = modelCountOf(mini);
  const isSquad = models > 1;

  $('mini-back').href = '#/army/' + mini.armyId;
  $('mini-back').textContent = '‹ ' + (army ? army.name : 'Back');
  $('mini-title').textContent = mini.name;
  $('mini-army-text').textContent = (isSquad ? plural(models, 'model') + ' · added ' : 'Added ') + formatDate(mini.createdAt);
  $('mini-edit').href = '#/mini/' + miniId + '/edit';
  $('mini-notes-text').textContent = mini.notes || 'No notes.';
  $('squad-summary').textContent = isSquad ? describeCounts(counts) : '';
  $('squad-summary').hidden = !isSquad;

  // Stage bar: one button per stage, filled up to the squad's overall stage.
  // Tapping a stage sets every model to that stage.
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
    button.addEventListener('click', () => setAllModels(stage.key));
    bar.append(button);
  });

  // Next stage: moves the least-advanced models on by one stage.
  const next = STAGES[current + 1];
  $('stage-next').hidden = !next;
  if (next) {
    const behind = counts[mini.stage];
    $('stage-next').textContent = (isSquad && behind < models)
      ? 'Move ' + behind + ' ' + stageLabel(mini.stage).toLowerCase() + ' → ' + next.label
      : 'Next stage: ' + next.label + ' →';
  }

  renderSquadRows(counts, isSquad);
  showScreen('mini');
}

// For squads: one row per stage with its count and buttons to move one model back or on.
function renderSquadRows(counts, isSquad) {
  const rows = $('squad-rows');
  rows.replaceChildren();
  rows.hidden = !isSquad;
  if (!isSquad) {
    return;
  }
  rows.append(el('p', 'hint', 'Move single models between stages:'));
  STAGES.forEach((stage, i) => {
    const count = counts[stage.key] || 0;
    const row = el('div', 'squad-row');
    row.append(el('span', 'squad-label', stage.label));
    row.append(el('span', 'squad-count', String(count)));

    const back = el('button', 'small secondary', '‹');
    back.setAttribute('aria-label', 'Move one ' + stage.label + ' model back');
    back.disabled = count === 0 || i === 0;
    back.addEventListener('click', () => moveOne(stage.key, STAGES[i - 1].key));

    const on = el('button', 'small', '›');
    on.setAttribute('aria-label', 'Move one ' + stage.label + ' model on');
    on.disabled = count === 0 || i === STAGES.length - 1;
    on.addEventListener('click', () => moveOne(stage.key, STAGES[i + 1].key));

    row.append(back, on);
    rows.append(row);
  });
}

async function saveCounts(counts) {
  await db.miniatures.update(currentMini.id, squadFields(counts));
  await showMini(currentMini.id);
}

function moveOne(fromKey, toKey) {
  const counts = { ...stageCountsOf(currentMini) };
  if (!(counts[fromKey] > 0)) {
    return;
  }
  counts[fromKey] -= 1;
  counts[toKey] = (counts[toKey] || 0) + 1;
  saveCounts(counts);
}

function setAllModels(stageKey) {
  const counts = stageCountsOf(currentMini);
  const models = modelCountOf(currentMini);
  const mixed = Object.keys(counts).length > 1;
  if (mixed && !confirm('Set all ' + models + ' models to ' + stageLabel(stageKey) + '?')) {
    return;
  }
  saveCounts({ [stageKey]: models });
}

$('stage-next').addEventListener('click', () => {
  const counts = { ...stageCountsOf(currentMini) };
  const from = currentMini.stage;
  const next = STAGES[stageIndex(from) + 1];
  if (!next) {
    return;
  }
  counts[next.key] = (counts[next.key] || 0) + (counts[from] || 0);
  counts[from] = 0;
  saveCounts(counts);
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
