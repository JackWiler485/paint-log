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
  [/^#\/scheme\/new\/(\d+)(?:\/for\/(\d+))?$/, (m) => showSchemeForm(null, Number(m[1]), m[2] ? Number(m[2]) : null)],
  [/^#\/scheme\/(\d+)\/edit$/, (m) => showSchemeForm(Number(m[1]))],
  [/^#\/scheme\/(\d+)\/step\/new$/, (m) => showStepForm(null, Number(m[1]))],
  [/^#\/scheme\/(\d+)$/, (m) => showScheme(Number(m[1]))],
  [/^#\/step\/(\d+)\/edit$/, (m) => showStepForm(Number(m[1]))],
  [/^#\/paints$/, () => showPaints()],
  [/^#\/paint\/new$/, () => showPaintForm(null)],
  [/^#\/paint\/(\d+)$/, (m) => showPaintForm(Number(m[1]))],
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
  await saveQueue; // finish any saves still waiting (see saveCounts)
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

  // Colour schemes: name, colour strip, steps and how many units use each.
  const schemes = await db.schemes.where('armyId').equals(armyId).sortBy('name');
  const allSteps = await db.schemeSteps.where('schemeId').anyOf(schemes.map((s) => s.id)).toArray();
  const paints = await paintMap();
  const schemeList = $('scheme-list');
  schemeList.replaceChildren();
  for (const scheme of schemes) {
    const steps = allSteps.filter((s) => s.schemeId === scheme.id).sort((a, b) => a.order - b.order);
    const users = minis.filter((m) => m.schemeId === scheme.id).length;
    const link = el('a', 'list-item');
    link.href = '#/scheme/' + scheme.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', scheme.name));
    text.append(schemeStrip(steps, paints));
    text.append(el('div', 'list-sub', plural(steps.length, 'step') + ' · used by ' + plural(users, 'unit')));
    link.append(text, el('span', 'chevron', '›'));
    const item = el('li');
    item.append(link);
    schemeList.append(item);
  }
  $('scheme-empty').hidden = schemes.length > 0;
  $('scheme-add').href = '#/scheme/new/' + armyId;
  showScreen('army');
}

$('army-delete').addEventListener('click', async () => {
  const army = await db.armies.get(currentArmyId);
  const count = await db.miniatures.where('armyId').equals(currentArmyId).count();
  if (!army || !confirm('Delete "' + army.name + '", its ' + count + ' miniatures and its colour schemes? This cannot be undone.')) {
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
let currentMiniArmyName = '';

async function showMini(miniId) {
  const mini = await db.miniatures.get(miniId);
  if (!mini) {
    return goTo('#/');
  }
  const army = await db.armies.get(mini.armyId);
  currentMini = mini;
  currentMiniArmyName = army ? army.name : '';
  drawMini();
  await drawMiniScheme();
  showScreen('mini');
}

// The miniature's colour scheme: a picker and the chosen scheme's steps.
async function drawMiniScheme() {
  const mini = currentMini;
  const schemes = await db.schemes.where('armyId').equals(mini.armyId).sortBy('name');
  const select = $('mini-scheme');
  const none = el('option', '', schemes.length ? 'No scheme' : 'No schemes in this army yet');
  none.value = '';
  select.replaceChildren(none, ...schemes.map((scheme) => {
    const option = el('option', '', scheme.name);
    option.value = scheme.id;
    return option;
  }));
  const scheme = schemes.find((s) => s.id === mini.schemeId);
  select.value = scheme ? String(scheme.id) : '';

  const list = $('mini-scheme-steps');
  list.replaceChildren();
  if (scheme) {
    const steps = await stepsOfScheme(scheme.id);
    const paints = await paintMap();
    steps.forEach((step, i) => list.append(stepRow(step, i, paints, null)));
    if (!steps.length) {
      list.append(el('li', 'empty-row', 'This scheme has no steps yet.'));
    }
  }
  $('mini-scheme-edit').hidden = !scheme;
  if (scheme) {
    $('mini-scheme-edit').href = '#/scheme/' + scheme.id;
  }
  $('mini-scheme-new').href = '#/scheme/new/' + mini.armyId + '/for/' + mini.id;
}

$('mini-scheme').addEventListener('change', async () => {
  const schemeId = Number($('mini-scheme').value) || undefined;
  currentMini.schemeId = schemeId;
  await saveQueue;
  await db.miniatures.update(currentMini.id, { schemeId });
  await drawMiniScheme();
});

// Draw the miniature screen from currentMini. This is instant (no database
// reading), so the screen keeps up with quick taps.
function drawMini() {
  const mini = currentMini;
  const counts = stageCountsOf(mini);
  const models = modelCountOf(mini);
  const isSquad = models > 1;

  $('mini-back').href = '#/army/' + mini.armyId;
  $('mini-back').textContent = '‹ ' + (currentMiniArmyName || 'Back');
  $('mini-title').textContent = mini.name;
  $('mini-army-text').textContent = (isSquad ? plural(models, 'model') + ' · added ' : 'Added ') + formatDate(mini.createdAt);
  $('mini-edit').href = '#/mini/' + mini.id + '/edit';
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
    button.dataset.setAll = stage.key;
    if (i <= current) {
      button.classList.add('reached');
    }
    if (i === current) {
      button.classList.add('current');
    }
    bar.append(button);
  });

  // Next stage: moves the least-advanced models on by one stage.
  // When everything is based it stays in place (greyed out), so nothing
  // below it jumps up under the finger.
  const next = STAGES[current + 1];
  const nextButton = $('stage-next');
  setInactive(nextButton, !next);
  if (!next) {
    nextButton.textContent = isSquad ? 'All models based ✓' : 'Based ✓';
  } else {
    const behind = counts[mini.stage];
    nextButton.textContent = (isSquad && behind < models)
      ? 'Move ' + behind + ' ' + stageLabel(mini.stage).toLowerCase() + ' → ' + next.label
      : 'Next stage: ' + next.label + ' →';
  }

  renderSquadRows(counts, isSquad);
}

// Greyed-out buttons use aria-disabled instead of disabled, so they still
// receive taps (which the app then ignores). See handleQuickTaps.
function setInactive(button, inactive) {
  if (inactive) {
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-disabled');
  }
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
    setInactive(back, count === 0 || i === 0);
    if (i > 0) {
      back.dataset.from = stage.key;
      back.dataset.to = STAGES[i - 1].key;
    }

    const on = el('button', 'small', '›');
    on.setAttribute('aria-label', 'Move one ' + stage.label + ' model on');
    setInactive(on, count === 0 || i === STAGES.length - 1);
    if (i < STAGES.length - 1) {
      on.dataset.from = stage.key;
      on.dataset.to = STAGES[i + 1].key;
    }

    row.append(back, on);
    rows.append(row);
  });
}

// ---------- Quick taps without zooming ----------
// iPhone Safari treats two quick taps as "double-tap to zoom". In an area
// meant for quick tapping, the app handles each touch itself and tells
// Safari to ignore it, which stops the zoom. This covers every tap in the
// area, including greyed-out buttons and the gaps between buttons.
// Scrolling (a moving finger) and pinch-zoom (two fingers) are left alone.
// Mouse, keyboard and VoiceOver taps arrive as normal clicks.

const TAP_MOVE_LIMIT = 10; // pixels a finger may move and still count as a tap
const CLICK_IGNORE_MS = 600; // ignore a click this soon after a handled touch
const SCROLL_SETTLE_MS = 150; // a touch this soon after scrolling just stops the scroll

// Touching the screen to stop a flicked list must not tap what is under the finger.
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
  lastScrollTime = Date.now();
}, { passive: true });

function handleQuickTaps(area, onTap) {
  let start = null;
  let lastTouchTime = 0;

  function tapButton(target) {
    const button = target.closest('button');
    if (button && area.contains(button) && button.getAttribute('aria-disabled') !== 'true') {
      onTap(button);
    }
  }

  area.addEventListener('touchstart', (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    const scrolling = Date.now() - lastScrollTime < SCROLL_SETTLE_MS;
    start = touch && !scrolling ? { x: touch.clientX, y: touch.clientY, scrollY: window.scrollY } : null;
  }, { passive: true });

  area.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const tapped = start && event.touches.length === 0 &&
      window.scrollY === start.scrollY &&
      Math.abs(touch.clientX - start.x) <= TAP_MOVE_LIMIT &&
      Math.abs(touch.clientY - start.y) <= TAP_MOVE_LIMIT;
    start = null;
    if (!tapped) {
      return; // a scroll, a touch that stopped a scroll, or a pinch: let Safari handle it
    }
    event.preventDefault();
    lastTouchTime = Date.now();
    tapButton(event.target);
  }, { passive: false });

  area.addEventListener('click', (event) => {
    if (Date.now() - lastTouchTime < CLICK_IGNORE_MS) {
      return; // this tap was already handled as a touch
    }
    tapButton(event.target);
  });
}

handleQuickTaps($('stage-controls'), (button) => {
  if (button.id === 'stage-next') {
    nextStage();
  } else if (button.dataset.setAll) {
    setAllModels(button.dataset.setAll);
  } else if (button.dataset.from) {
    moveOne(button.dataset.from, button.dataset.to);
  }
});

// Saves wait in a queue, one after another, so quick taps are saved in order
// and none are lost. Other screens wait for the queue before reading.
let saveQueue = Promise.resolve();

function queueSave(task) {
  saveQueue = saveQueue
    .then(task)
    .catch((err) => alert('Could not save: ' + err.name + ' - ' + err.message));
}

function saveCounts(counts) {
  const fields = squadFields(counts);
  const id = currentMini.id;
  Object.assign(currentMini, fields);
  drawMini();
  queueSave(() => db.miniatures.update(id, fields));
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

function nextStage() {
  const counts = { ...stageCountsOf(currentMini) };
  const from = currentMini.stage;
  const next = STAGES[stageIndex(from) + 1];
  if (!next) {
    return;
  }
  counts[next.key] = (counts[next.key] || 0) + (counts[from] || 0);
  counts[from] = 0;
  saveCounts(counts);
}

$('mini-delete').addEventListener('click', async () => {
  if (!confirm('Delete "' + currentMini.name + '"? This cannot be undone.')) {
    return;
  }
  await deleteMiniatures([currentMini.id]);
  goTo('#/army/' + currentMini.armyId);
});

// ---------- Colour schemes: shared helpers ----------

async function paintMap() {
  const paints = await db.paints.toArray();
  return new Map(paints.map((p) => [p.id, p]));
}

async function stepsOfScheme(schemeId) {
  const steps = await db.schemeSteps.where('schemeId').equals(schemeId).toArray();
  return steps.sort((a, b) => a.order - b.order);
}

// One step as a list row: swatch, paint, part · technique, note, "Not owned".
// With buttons: tapping the text edits the step, plus move up and move down
// (handled by handleQuickTaps).
function stepRow(step, index, paints, buttons) {
  const paint = paints.get(step.paintId);
  const item = el('li', 'step-row');
  item.append(el('span', 'step-number', String(index + 1)), paintSwatch(paint));

  const text = el(buttons ? 'button' : 'div', 'list-text step-text');
  text.append(el('div', 'list-title', paint ? paintLabel(paint) : 'Paint missing'));
  const sub = [step.partName, step.technique].filter(Boolean).join(' · ');
  if (sub) {
    text.append(el('div', 'list-sub', sub));
  }
  if (step.note) {
    text.append(el('div', 'list-sub step-note', step.note));
  }
  if (paint && !paint.owned) {
    text.append(el('div', 'not-owned', 'Not owned'));
  }
  item.append(text);

  if (buttons) {
    text.dataset.edit = step.id;
    text.setAttribute('aria-label', 'Edit step ' + (index + 1));
    const up = el('button', 'small secondary', '↑');
    up.setAttribute('aria-label', 'Move step up');
    up.dataset.step = step.id;
    up.dataset.move = '-1';
    setInactive(up, buttons.first);
    const down = el('button', 'small secondary', '↓');
    down.setAttribute('aria-label', 'Move step down');
    down.dataset.step = step.id;
    down.dataset.move = '1';
    setInactive(down, buttons.last);
    const group = el('div', 'step-buttons');
    group.append(up, down);
    item.append(group);
  }
  return item;
}

// A strip of small swatches, one per paint in the scheme.
function schemeStrip(steps, paints) {
  const strip = el('span', 'scheme-strip');
  const seen = new Set();
  for (const step of steps) {
    if (seen.has(step.paintId) || seen.size >= 10) {
      continue;
    }
    seen.add(step.paintId);
    strip.append(paintSwatch(paints.get(step.paintId), 'small'));
  }
  return strip;
}

// ---------- One colour scheme ----------

let currentScheme = null;
let currentSteps = [];
let currentPaints = new Map();

async function showScheme(schemeId) {
  const scheme = await db.schemes.get(schemeId);
  if (!scheme) {
    return goTo('#/');
  }
  const army = await db.armies.get(scheme.armyId);
  const users = await db.miniatures.where('armyId').equals(scheme.armyId)
    .filter((m) => m.schemeId === schemeId).toArray();
  currentScheme = scheme;
  currentSteps = await stepsOfScheme(schemeId);
  currentPaints = await paintMap();

  $('scheme-back').href = '#/army/' + scheme.armyId;
  $('scheme-back').textContent = '‹ ' + (army ? army.name : 'Back');
  $('scheme-title').textContent = scheme.name;
  $('scheme-used-by').textContent = users.length
    ? 'Used by: ' + users.map((m) => m.name).join(', ')
    : 'Not used by any unit yet. Pick it on a miniature\'s screen.';
  $('step-add').href = '#/scheme/' + schemeId + '/step/new';
  $('scheme-rename').href = '#/scheme/' + schemeId + '/edit';
  drawSteps();
  showScreen('scheme');
}

function drawSteps() {
  const list = $('step-list');
  list.replaceChildren();
  currentSteps.forEach((step, i) => {
    list.append(stepRow(step, i, currentPaints, { first: i === 0, last: i === currentSteps.length - 1 }));
  });
  $('step-empty').hidden = currentSteps.length > 0;
}

handleQuickTaps($('step-list'), (button) => {
  if (button.dataset.edit) {
    location.hash = '#/step/' + button.dataset.edit + '/edit';
  } else if (button.dataset.move) {
    moveStep(Number(button.dataset.step), Number(button.dataset.move));
  }
});

// Swap a step with its neighbour. The screen updates at once; saving is queued.
function moveStep(stepId, direction) {
  const i = currentSteps.findIndex((s) => s.id === stepId);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= currentSteps.length) {
    return;
  }
  [currentSteps[i], currentSteps[j]] = [currentSteps[j], currentSteps[i]];
  currentSteps.forEach((step, index) => {
    step.order = index;
  });
  drawSteps();
  const rows = currentSteps.map((step) => ({ ...step }));
  queueSave(() => db.schemeSteps.bulkPut(rows));
}

$('scheme-delete').addEventListener('click', async () => {
  const scheme = currentScheme;
  const users = await db.miniatures.filter((m) => m.schemeId === scheme.id).count();
  const message = 'Delete the scheme "' + scheme.name + '" and its steps?' +
    (users ? ' The ' + plural(users, 'unit') + ' using it will have no scheme (the units are kept).' : '');
  if (!confirm(message)) {
    return;
  }
  await deleteScheme(scheme.id);
  goTo('#/army/' + scheme.armyId);
});

// ---------- Scheme name form (new or rename) ----------

let schemeFormState = null;

async function showSchemeForm(schemeId, armyId, forMiniId) {
  let scheme = { name: '', armyId };
  if (schemeId) {
    scheme = await db.schemes.get(schemeId);
    if (!scheme) {
      return goTo('#/');
    }
  } else if (!(await db.armies.get(armyId))) {
    return goTo('#/');
  }
  schemeFormState = { schemeId, armyId: scheme.armyId, forMiniId };
  $('scheme-form-title').textContent = schemeId ? 'Rename scheme' : 'New scheme';
  $('scheme-form-back').href = schemeId ? '#/scheme/' + schemeId
    : (forMiniId ? '#/mini/' + forMiniId : '#/army/' + scheme.armyId);
  $('scheme-name').value = scheme.name;
  showScreen('scheme-form');
}

$('scheme-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('scheme-name').value.trim();
  if (!name) {
    return;
  }
  const { schemeId, armyId, forMiniId } = schemeFormState;
  if (schemeId) {
    await db.schemes.update(schemeId, { name });
    return goTo('#/scheme/' + schemeId);
  }
  const id = await db.schemes.add({ armyId, name, createdAt: Date.now() });
  if (forMiniId) {
    await db.miniatures.update(forMiniId, { schemeId: id });
  }
  goTo('#/scheme/' + id);
});

// ---------- Step form (new or edit) ----------

let stepForm = null;
let stepPaints = [];
const MAX_PAINT_RESULTS = 50;

for (const technique of TECHNIQUES) {
  const option = el('option', '', technique);
  option.value = technique;
  $('step-technique').append(option);
}

async function showStepForm(stepId, schemeId) {
  let step = { partName: '', technique: 'Base', paintId: null, note: '' };
  if (stepId) {
    step = await db.schemeSteps.get(stepId);
    if (!step) {
      return goTo('#/');
    }
    schemeId = step.schemeId;
  }
  const scheme = await db.schemes.get(schemeId);
  if (!scheme) {
    return goTo('#/');
  }
  stepPaints = await db.paints.toArray();
  stepForm = { stepId, schemeId, paintId: step.paintId, techniqueTouched: Boolean(stepId) };

  // Suggest parts already used in this army's schemes.
  const schemeIds = await db.schemes.where('armyId').equals(scheme.armyId).primaryKeys();
  const parts = new Set((await db.schemeSteps.where('schemeId').anyOf(schemeIds).toArray())
    .map((s) => s.partName).filter(Boolean));
  $('part-suggestions').replaceChildren(...[...parts].sort().map((part) => {
    const option = el('option');
    option.value = part;
    return option;
  }));

  $('step-form-title').textContent = (stepId ? 'Edit step' : 'New step') + ': ' + scheme.name;
  $('step-form-back').href = '#/scheme/' + schemeId;
  $('step-part').value = step.partName || '';
  $('step-technique').value = step.technique || 'Base';
  $('step-note').value = step.note || '';
  $('paint-search').value = '';
  $('paint-results').replaceChildren();
  $('step-delete').hidden = !stepId;
  drawChosenPaint();
  drawPaintResults();
  showScreen('step-form');
}

function drawChosenPaint() {
  const box = $('step-paint-chosen');
  box.replaceChildren();
  const paint = stepPaints.find((p) => p.id === stepForm.paintId);
  if (!paint) {
    box.append(el('span', 'hint', 'No paint chosen yet. Search below.'));
    return;
  }
  box.append(paintSwatch(paint, 'large'));
  const text = el('div', 'list-text');
  text.append(el('div', 'list-title', paintLabel(paint)));
  text.append(el('div', 'list-sub', paint.owned ? 'Owned' : 'Not owned'));
  box.append(text);
}

function drawPaintResults() {
  const query = $('paint-search').value.trim();
  const ownedOnly = $('paint-owned-only').checked;
  const list = $('paint-results');
  list.replaceChildren();
  if (!query && !ownedOnly) {
    $('paint-search-note').textContent = 'Type part of a paint name, or tick "Only paints I own" to list them.';
    return [];
  }
  const found = filterPaints(stepPaints, query, { ownedOnly });
  for (const paint of found.slice(0, MAX_PAINT_RESULTS)) {
    const button = el('button', 'list-item paint-result');
    button.type = 'button';
    button.append(paintSwatch(paint));
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', paintLabel(paint)));
    text.append(el('div', 'list-sub', paintTypeLabel(paint.type) + (paint.owned ? ' · owned' : '')));
    button.append(text);
    button.addEventListener('click', () => choosePaint(paint));
    const item = el('li');
    item.append(button);
    list.append(item);
  }
  let note = found.length === 0 ? 'No paints match. Missing paints can be added on the Paints screen.' : '';
  if (found.length > MAX_PAINT_RESULTS) {
    note = 'Showing ' + MAX_PAINT_RESULTS + ' of ' + found.length + '. Keep typing to narrow it down.';
  }
  $('paint-search-note').textContent = note;
  return found;
}

function choosePaint(paint) {
  stepForm.paintId = paint.id;
  if (!stepForm.techniqueTouched) {
    $('step-technique').value = suggestedTechnique(paint);
  }
  $('paint-search').value = '';
  $('paint-search').blur();
  drawChosenPaint();
  drawPaintResults();
  $('step-paint-chosen').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

$('paint-search').addEventListener('input', drawPaintResults);
$('paint-owned-only').addEventListener('change', drawPaintResults);
$('step-technique').addEventListener('change', () => {
  stepForm.techniqueTouched = true;
});

// The keyboard's Search/Enter key must not save the form.
$('paint-search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const found = drawPaintResults();
  if (found.length === 1) {
    choosePaint(found[0]);
  } else {
    $('paint-search').blur();
  }
});

$('step-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!stepForm.paintId) {
    $('paint-search-note').textContent = 'Pick a paint first.';
    $('paint-search').focus();
    return;
  }
  const fields = {
    partName: $('step-part').value.trim(),
    technique: $('step-technique').value,
    paintId: stepForm.paintId,
    note: $('step-note').value.trim(),
  };
  if (stepForm.stepId) {
    await db.schemeSteps.update(stepForm.stepId, fields);
  } else {
    const steps = await stepsOfScheme(stepForm.schemeId);
    const order = steps.length ? steps[steps.length - 1].order + 1 : 0;
    await db.schemeSteps.add({ schemeId: stepForm.schemeId, order, ...fields });
  }
  goTo('#/scheme/' + stepForm.schemeId);
});

$('step-delete').addEventListener('click', async () => {
  if (!confirm('Delete this step?')) {
    return;
  }
  await db.schemeSteps.delete(stepForm.stepId);
  goTo('#/scheme/' + stepForm.schemeId);
});

// ---------- Paints screen ----------

let allPaints = [];
let paintSyncError = '';

async function showPaints() {
  allPaints = await db.paints.toArray();
  const select = $('paints-range');
  const chosen = select.value;
  const all = el('option', '', 'All ranges (without Air)');
  all.value = '';
  select.replaceChildren(all, ...rangeNames(allPaints)
    .filter((range) => allPaints.some((p) => p.range === range))
    .map((range) => {
      const option = el('option', '', range);
      option.value = range;
      return option;
    }));
  select.value = chosen;
  drawPaintList();
  showScreen('paints');
}

function drawPaintList() {
  const found = filterPaints(allPaints, $('paints-search').value.trim(), {
    range: $('paints-range').value,
    ownedOnly: $('paints-owned-only').checked,
    showDiscontinued: $('paints-discontinued').checked,
    hideAir: true,
  });
  const owned = allPaints.filter((p) => p.owned).length;
  $('paints-count').textContent = paintSyncError ||
    ('Showing ' + found.length + ' paints. You own ' + owned + '. Tap ○ to mark a paint as owned.');

  const list = $('paint-list');
  list.replaceChildren();
  for (const paint of found) {
    const item = el('li', 'paint-row');
    const open = el('button', 'list-item paint-open');
    open.dataset.open = paint.id;
    open.append(paintSwatch(paint));
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', paint.name));
    const details = [paint.range, paintTypeLabel(paint.type)];
    if (paint.discontinued) {
      details.push('discontinued');
    }
    if (!paint.catalogueId) {
      details.push('added by you');
    }
    text.append(el('div', 'list-sub', details.filter(Boolean).join(' · ')));
    open.append(text);

    const toggle = el('button', 'owned-toggle');
    toggle.dataset.toggle = paint.id;
    drawOwnedToggle(toggle, paint);
    item.append(open, toggle);
    list.append(item);
  }
}

function drawOwnedToggle(button, paint) {
  button.textContent = paint.owned ? '✓' : '○';
  button.classList.toggle('owned', Boolean(paint.owned));
  button.setAttribute('aria-pressed', paint.owned ? 'true' : 'false');
  button.setAttribute('aria-label', (paint.owned ? 'Owned: ' : 'Not owned: ') + paint.name);
}

handleQuickTaps($('paint-list'), (button) => {
  if (button.dataset.toggle) {
    const paint = allPaints.find((p) => p.id === Number(button.dataset.toggle));
    if (!paint) {
      return;
    }
    paint.owned = !paint.owned;
    drawOwnedToggle(button, paint);
    const owned = paint.owned;
    queueSave(() => db.paints.update(paint.id, { owned }));
  } else if (button.dataset.open) {
    location.hash = '#/paint/' + button.dataset.open;
  }
});

$('paints-search').addEventListener('input', drawPaintList);
$('paints-range').addEventListener('change', drawPaintList);
$('paints-owned-only').addEventListener('change', drawPaintList);
$('paints-discontinued').addEventListener('change', drawPaintList);

// ---------- One paint (edit) or a new custom paint ----------

let editingPaint = null;

for (const type of PAINT_TYPES) {
  const option = el('option', '', type.label);
  option.value = type.key;
  $('paint-type').append(option);
}

async function showPaintForm(paintId) {
  let paint = { name: '', range: '', type: 'opaque', hex: '#808080', owned: true, metallic: false };
  if (paintId) {
    paint = await db.paints.get(paintId);
    if (!paint) {
      return goTo('#/paints');
    }
  }
  editingPaint = paint;
  const custom = !paint.catalogueId;

  $('paint-form-title').textContent = paintId ? paint.name : 'New paint';
  for (const id of ['paint-name-label', 'paint-range-label', 'paint-type-label', 'paint-metallic-label']) {
    $(id).hidden = !custom;
  }
  $('paint-name').required = custom;
  $('paint-name').value = paint.name;
  $('paint-range').value = paint.range || '';
  $('paint-type').value = paint.type || 'opaque';
  $('paint-metallic').checked = Boolean(paint.metallic);
  $('paint-owned').checked = Boolean(paint.owned);
  $('paint-hex').value = (HEX_PATTERN.test(paint.hex) ? paint.hex : '#808080').toLowerCase();

  const allRows = await db.paints.toArray();
  $('range-suggestions').replaceChildren(...rangeNames(allRows).map((range) => {
    const option = el('option');
    option.value = range;
    return option;
  }));

  const uses = paintId ? await db.schemeSteps.where('paintId').equals(paintId).count() : 0;
  $('paint-used-note').textContent = uses ? 'Used in ' + plural(uses, 'scheme step') + '.' : '';
  $('paint-delete').hidden = !(custom && paintId && uses === 0);
  drawPaintPreview();
  showScreen('paint-form');
}

function drawPaintPreview() {
  const paint = editingPaint;
  const hex = $('paint-hex').value.toUpperCase();
  const swatch = $('paint-preview-swatch');
  swatch.style.backgroundColor = hex;
  swatch.classList.toggle('metallic', paint.catalogueId ? Boolean(paint.metallic) : $('paint-metallic').checked);
  const details = paint.catalogueId
    ? [paint.range, paintTypeLabel(paint.type), paint.discontinued ? 'discontinued' : '', hex]
    : ['Added by you', hex];
  $('paint-preview-text').textContent = details.filter(Boolean).join(' · ');
  $('paint-reset-hex').hidden = !(paint.catalogueId && hex !== paint.catalogueHex);
}

$('paint-hex').addEventListener('input', drawPaintPreview);
$('paint-metallic').addEventListener('change', drawPaintPreview);

$('paint-reset-hex').addEventListener('click', () => {
  $('paint-hex').value = editingPaint.catalogueHex.toLowerCase();
  drawPaintPreview();
});

$('paint-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const hex = $('paint-hex').value.toUpperCase();
  const owned = $('paint-owned').checked;
  if (editingPaint.catalogueId) {
    await db.paints.update(editingPaint.id, { hex, owned });
    return goTo('#/paints');
  }
  const name = $('paint-name').value.trim();
  if (!name) {
    return;
  }
  const fields = {
    name,
    range: $('paint-range').value.trim(),
    type: $('paint-type').value,
    metallic: $('paint-metallic').checked,
    hex,
    owned,
    custom: true,
  };
  if (editingPaint.id) {
    await db.paints.update(editingPaint.id, fields);
  } else {
    await db.paints.add(fields);
  }
  goTo('#/paints');
});

$('paint-delete').addEventListener('click', async () => {
  if (!confirm('Delete the paint "' + editingPaint.name + '"?')) {
    return;
  }
  await db.paints.delete(editingPaint.id);
  goTo('#/paints');
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
    await syncPaints().catch(() => {}); // add paints the backup didn't have yet
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
  .then(() => syncPaints().catch((err) => {
    paintSyncError = 'The paint list could not be loaded: ' + err.message;
  }))
  .then(render)
  .catch((err) => {
    document.querySelector('main').textContent =
      'Could not open the database: ' + err.name + ' - ' + err.message;
  });
