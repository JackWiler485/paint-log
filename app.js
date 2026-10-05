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
  [/^#\/list\/new\/(\d+)$/, (m) => showListForm(null, Number(m[1]))],
  [/^#\/list\/(\d+)\/edit$/, (m) => showListForm(Number(m[1]))],
  [/^#\/list\/(\d+)\/add$/, (m) => showListAdd(Number(m[1]))],
  [/^#\/list\/(\d+)$/, (m) => showList(Number(m[1]))],
  [/^#\/entry\/(\d+)$/, (m) => showEntry(Number(m[1]))],
  [/^#\/paints$/, () => showPaints()],
  [/^#\/shop$/, () => showShop()],
  [/^#\/photo\/(\d+)$/, (m) => showPhoto(Number(m[1]))],
  [/^#\/spin\/new\/(\d+)$/, (m) => showSpinCapture(Number(m[1]))],
  [/^#\/spin\/(\d+)$/, (m) => showSpin(Number(m[1]))],
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
  if (name !== 'spin-capture') {
    leaveSpinCapture();
  }
  if (name !== 'spin') {
    viewPlayer.clear(); // frees the memory the spin's pictures use
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
      updateShopCount().catch(() => {});
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

  // The latest photo of each miniature, shown as a small picture.
  const latestPhoto = new Map();
  for (const photo of await db.photos.where('miniatureId').anyOf(minis.map((m) => m.id)).toArray()) {
    const current = latestPhoto.get(photo.miniatureId);
    if (!current || photo.takenAt > current.takenAt) {
      latestPhoto.set(photo.miniatureId, photo);
    }
  }
  const thumbUrl = newUrlGroup('army-thumbs');

  const list = $('mini-list');
  list.replaceChildren();
  for (const mini of minis) {
    const link = el('a', 'list-item');
    link.href = '#/mini/' + mini.id;
    if (latestPhoto.size) {
      const photo = latestPhoto.get(mini.id);
      const thumb = el(photo ? 'img' : 'span', 'thumb-small');
      if (photo) {
        thumb.src = thumbUrl(photo.thumb || photo.blob);
        thumb.alt = '';
      }
      link.append(thumb);
    }
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
  await drawArmyLists(army);
  showScreen('army');
}

$('army-delete').addEventListener('click', async () => {
  const army = await db.armies.get(currentArmyId);
  const count = await db.miniatures.where('armyId').equals(currentArmyId).count();
  if (!army || !confirm('Delete "' + army.name + '", its ' + count + ' miniatures, its colour schemes and its army lists? This cannot be undone.')) {
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
  setText('photo-status', '');
  await drawMiniPhotos();
  await drawMiniSpins();
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
  $('paint-onlist').checked = Boolean(paint.onList);
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
  const onList = $('paint-onlist').checked;
  if (editingPaint.catalogueId) {
    await db.paints.update(editingPaint.id, { hex, owned, onList });
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
    onList,
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

// ---------- Progress photos on the miniature screen ----------

$('photo-add').addEventListener('click', () => $('photo-input').click());

$('photo-input').addEventListener('change', async () => {
  const input = $('photo-input');
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) {
    return;
  }
  const mini = currentMini;
  let saved = 0;
  const problems = [];
  for (const [i, file] of files.entries()) {
    setText('photo-status', 'Saving photo ' + (i + 1) + ' of ' + files.length + '…');
    try {
      const prepared = await preparePhoto(file);
      await db.photos.add({ miniatureId: mini.id, stage: mini.stage, note: '', ...prepared });
      saved++;
    } catch (err) {
      problems.push((file.name || 'photo') + ': ' + err.message);
    }
  }
  if (problems.length) {
    setText('photo-status', 'Saved ' + saved + '. Could not save ' + problems.join('; '), 'bad');
  } else {
    setText('photo-status', saved === 1 ? 'Photo saved.' : saved + ' photos saved.', 'ok');
  }
  if (currentMini && currentMini.id === mini.id) {
    await drawMiniPhotos();
  }
});

// The timeline: newest photo first, with date, stage and note.
async function drawMiniPhotos() {
  const photos = await db.photos.where('miniatureId').equals(currentMini.id).toArray();
  photos.sort((a, b) => b.takenAt - a.takenAt);
  const url = newUrlGroup('mini-photos');
  const list = $('photo-list');
  list.replaceChildren();
  for (const photo of photos) {
    const link = el('a', 'list-item photo-row');
    link.href = '#/photo/' + photo.id;
    const img = el('img', 'thumb');
    img.src = url(photo.thumb || photo.blob);
    img.alt = 'Photo from ' + formatDate(photo.takenAt);
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', formatDate(photo.takenAt)));
    if (photo.stage) {
      text.append(stageBadge(photo.stage));
    }
    if (photo.note) {
      text.append(el('div', 'list-sub', photo.note));
    }
    link.append(img, text, el('span', 'chevron', '›'));
    const item = el('li');
    item.append(link);
    list.append(item);
  }
  $('photo-empty').hidden = photos.length > 0;
}

// ---------- Photo viewer ----------

let viewerPhotos = [];
let viewerIndex = 0;
let viewerMini = null;

for (const stage of STAGES) {
  const option = el('option', '', stage.label);
  option.value = stage.key;
  $('photo-stage').append(option);
}

async function showPhoto(photoId) {
  const photo = await db.photos.get(photoId);
  if (!photo) {
    return goTo('#/');
  }
  viewerMini = await db.miniatures.get(photo.miniatureId);
  viewerPhotos = (await db.photos.where('miniatureId').equals(photo.miniatureId).toArray())
    .sort((a, b) => b.takenAt - a.takenAt);
  viewerIndex = viewerPhotos.findIndex((p) => p.id === photoId);
  $('photo-back').href = '#/mini/' + photo.miniatureId;
  $('photo-back').textContent = '‹ ' + (viewerMini ? viewerMini.name : 'Back');
  drawPhoto();
  showScreen('photo');
}

function drawPhoto() {
  const photo = viewerPhotos[viewerIndex];
  const url = newUrlGroup('viewer');
  $('photo-full').src = url(photo.blob);
  $('photo-full').alt = 'Photo from ' + formatDate(photo.takenAt);
  $('photo-position').textContent = (viewerIndex + 1) + ' of ' + viewerPhotos.length;
  setInactive($('photo-prev'), viewerIndex === 0);
  setInactive($('photo-next'), viewerIndex === viewerPhotos.length - 1);
  $('photo-nav').hidden = viewerPhotos.length < 2;

  const meta = $('photo-meta');
  meta.replaceChildren(el('span', '', formatDate(photo.takenAt) + ' '));
  if (photo.stage) {
    meta.append(stageBadge(photo.stage));
  }
  $('photo-date').value = dateFieldValue(photo.takenAt);
  $('photo-stage').value = photo.stage || 'sprue';
  $('photo-note').value = photo.note || '';
  setText('photo-form-status', '');
}

// Move to a newer (-1) or older (+1) photo. The address is updated without
// adding to the back history, so "back" returns to the miniature.
function showNeighbour(direction) {
  const next = viewerIndex + direction;
  if (next < 0 || next >= viewerPhotos.length) {
    return;
  }
  viewerIndex = next;
  history.replaceState(null, '', '#/photo/' + viewerPhotos[next].id);
  drawPhoto();
}

handleQuickTaps($('photo-nav'), (button) => {
  showNeighbour(button.id === 'photo-prev' ? -1 : 1);
});

// Swipe left for an older photo, right for a newer one.
// Two-finger pinch-zoom on the photo is left to Safari.
let swipeStart = null;
$('photo-frame').addEventListener('touchstart', (event) => {
  const touch = event.touches.length === 1 ? event.touches[0] : null;
  swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });

$('photo-frame').addEventListener('touchend', (event) => {
  if (!swipeStart || event.touches.length > 0) {
    swipeStart = null;
    return;
  }
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipeStart.x;
  const dy = touch.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    showNeighbour(dx < 0 ? 1 : -1);
  }
}, { passive: true });

$('photo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const photo = viewerPhotos[viewerIndex];
  if (!$('photo-date').value) {
    return;
  }
  const changes = {
    takenAt: withDate(photo.takenAt, $('photo-date').value),
    stage: $('photo-stage').value,
    note: $('photo-note').value.trim(),
  };
  await db.photos.update(photo.id, changes);
  Object.assign(photo, changes);
  // A new date can change the order.
  viewerPhotos.sort((a, b) => b.takenAt - a.takenAt);
  viewerIndex = viewerPhotos.indexOf(photo);
  drawPhoto();
  setText('photo-form-status', 'Saved.', 'ok');
});

$('photo-share').addEventListener('click', async () => {
  const photo = viewerPhotos[viewerIndex];
  const name = slugify(viewerMini ? viewerMini.name : 'photo') + '-' + dateFieldValue(photo.takenAt) + '.jpg';
  const file = new File([photo.blob], name, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      const url = URL.createObjectURL(file);
      const link = el('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      setText('photo-form-status', 'Could not share: ' + err.name + ' - ' + err.message, 'bad');
    }
  }
});

$('photo-delete').addEventListener('click', async () => {
  const photo = viewerPhotos[viewerIndex];
  if (!confirm('Delete this photo? This cannot be undone.')) {
    return;
  }
  await db.photos.delete(photo.id);
  viewerPhotos.splice(viewerIndex, 1);
  if (!viewerPhotos.length) {
    return goTo('#/mini/' + photo.miniatureId);
  }
  viewerIndex = Math.min(viewerIndex, viewerPhotos.length - 1);
  history.replaceState(null, '', '#/photo/' + viewerPhotos[viewerIndex].id);
  drawPhoto();
});

// ---------- 360° spins on the miniature screen ----------

async function drawMiniSpins() {
  const spins = await db.spins.where('miniatureId').equals(currentMini.id).toArray();
  spins.sort((a, b) => b.takenAt - a.takenAt);
  const url = newUrlGroup('mini-spins');
  const list = $('spin-list');
  list.replaceChildren();
  for (const spin of spins) {
    const link = el('a', 'list-item photo-row');
    link.href = '#/spin/' + spin.id;
    const img = el('img', 'thumb');
    img.src = url(spin.thumb || spin.frames[0]);
    img.alt = 'Spin from ' + formatDate(spin.takenAt);
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', formatDate(spin.takenAt)));
    text.append(el('div', 'list-sub', plural(spin.frames.length, 'picture') + (spin.note ? ' · ' + spin.note : '')));
    if (spin.stage) {
      text.append(stageBadge(spin.stage));
    }
    link.append(img, text, el('span', 'chevron', '›'));
    const item = el('li');
    item.append(link);
    list.append(item);
  }
  $('spin-empty').hidden = spins.length > 0;
  $('spin-new').href = '#/spin/new/' + currentMini.id;
}

// ---------- Taking a 360° spin ----------
// The live camera shows on screen. In Auto mode the app takes a picture
// every 1-2 seconds while the model turns; in Tap mode, one per tap.
// Pictures stay in memory until "Save spin", so "Retake" costs nothing.

const spinVideo = $('spin-video');
const reviewPlayer = createSpinPlayer($('spin-review-stage'), $('spin-review-canvas'), $('spin-review-play'));
const SPIN_SETTINGS_KEY = 'paint-log-spin-settings';
const SPIN_TAP_PAUSE_MS = 400; // a tap this soon after the main button changed is ignored

let spinMini = null;
let spinStream = null;
// off, starting, ready, countdown, capturing, finishing, review or saving
let spinState = 'off';
let spinFrames = [];
let spinGrabs = Promise.resolve(); // pictures are taken one after another
let spinTimer = null;
let spinWakeLock = null;
let spinFrameUrls = [];
let spinGoChangedAt = 0;
let spinSettings = { mode: 'auto', interval: 1000, target: 36 };

function loadSpinSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SPIN_SETTINGS_KEY));
    if (saved) {
      spinSettings = { ...spinSettings, ...saved };
    }
  } catch (err) {
    // No saved choices: use the defaults.
  }
  $('spin-mode').value = spinSettings.mode;
  $('spin-interval').value = String(spinSettings.interval);
  $('spin-target').value = String(spinSettings.target);
}

function saveSpinSettings() {
  spinSettings = {
    mode: $('spin-mode').value,
    interval: Number($('spin-interval').value),
    target: Number($('spin-target').value),
  };
  try {
    localStorage.setItem(SPIN_SETTINGS_KEY, JSON.stringify(spinSettings));
  } catch (err) {
    // Not saved: the choices are just used this time.
  }
  drawSpinControls();
}

$('spin-mode').addEventListener('change', saveSpinSettings);
$('spin-interval').addEventListener('change', saveSpinSettings);
$('spin-target').addEventListener('change', saveSpinSettings);

async function showSpinCapture(miniId) {
  const mini = await db.miniatures.get(miniId);
  if (!mini) {
    return goTo('#/');
  }
  spinMini = mini;
  $('spin-capture-back').href = '#/mini/' + mini.id;
  $('spin-capture-back').textContent = '‹ ' + mini.name;
  loadSpinSettings();
  leaveSpinCapture();
  setText('spin-status', '');
  showScreen('spin-capture');
  startSpinCamera();
}

async function startSpinCamera() {
  if (spinStream || spinState !== 'off') {
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setText('spin-status', 'The live camera is not available here.', 'bad');
    return drawSpinControls();
  }
  spinState = 'starting';
  drawSpinControls();
  setText('spin-status', 'Starting the camera…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    // Left the screen (or the app) while the camera was starting?
    if (spinState !== 'starting' || document.hidden || $('screen-spin-capture').hidden) {
      stream.getTracks().forEach((track) => track.stop());
      if (spinState === 'starting') {
        spinState = 'off';
        setText('spin-status', '');
        drawSpinControls();
      }
      return;
    }
    spinStream = stream;
    spinVideo.srcObject = stream;
    await spinVideo.play();
    spinState = 'ready';
    setText('spin-status', '');
  } catch (err) {
    setText('spin-status', 'Camera failed: ' + err.name + ' - ' + err.message, 'bad');
    stopSpinCamera();
    spinState = 'off';
  }
  drawSpinControls();
}

function stopSpinCamera() {
  if (spinStream) {
    spinStream.getTracks().forEach((track) => track.stop());
    spinStream = null;
  }
  spinVideo.srcObject = null;
  releaseSpinWakeLock();
}

// Leaving the screen: stop everything and forget unsaved pictures.
function leaveSpinCapture() {
  clearTimeout(spinTimer);
  spinState = 'off';
  stopSpinCamera();
  freeFrameCanvas();
  spinFrames = [];
  reviewPlayer.clear();
  newUrlGroup('spin-review');
  spinFrameUrls = [];
}

// The app went into the background.
function pauseSpinCapture() {
  if (spinState === 'countdown' || spinState === 'capturing') {
    finishSpinCapture();
  } else if (spinState === 'starting' || spinState === 'ready') {
    spinState = 'off';
    stopSpinCamera();
    drawSpinControls();
  }
}

// Keep the screen from switching off while pictures are taken (where the
// phone allows it; nothing happens otherwise).
async function requestSpinWakeLock() {
  try {
    if (navigator.wakeLock) {
      spinWakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    spinWakeLock = null;
  }
}

function releaseSpinWakeLock() {
  if (spinWakeLock) {
    spinWakeLock.release().catch(() => {});
    spinWakeLock = null;
  }
}

function drawSpinControls() {
  const state = spinState;
  const auto = spinSettings.mode === 'auto';
  const reviewing = state === 'review' || state === 'saving';
  const taking = state === 'capturing' || state === 'finishing';
  $('spin-live').hidden = reviewing;
  $('spin-review').hidden = !reviewing;
  $('spin-options').disabled = !['off', 'starting', 'ready'].includes(state);
  $('spin-interval-label').hidden = !auto;

  const target = spinSettings.target;
  const degrees = Math.round(360 / target);
  $('spin-turn-hint').textContent = auto
    ? 'Turn the model slowly, once around in about ' + Math.round(target * spinSettings.interval / 1000) + ' seconds. It stops by itself after ' + target + ' pictures.'
    : 'Turn the model a little (about ' + degrees + '°) between taps, ' + target + ' times in all.';

  let goText = 'Start camera';
  let extraText = '';
  if (state === 'starting') {
    goText = 'Starting camera…';
  } else if (state === 'ready') {
    goText = auto ? 'Start spin' : 'Snap first picture';
  } else if (state === 'countdown') {
    goText = 'Cancel';
  } else if (taking) {
    goText = auto ? 'Stop' : 'Snap';
    extraText = auto ? 'Snap now' : 'Done';
  }
  const go = $('spin-go');
  if (go.textContent !== goText) {
    spinGoChangedAt = Date.now();
  }
  go.textContent = goText;
  setInactive(go, state === 'starting' || state === 'finishing');
  const extra = $('spin-extra');
  extra.textContent = extraText;
  extra.hidden = !extraText;
  setInactive(extra, state === 'finishing');

  $('spin-counter').hidden = !taking;
  $('spin-counter').textContent = spinFrames.length + ' / ' + target;
  if (state !== 'countdown') {
    $('spin-big').hidden = true;
  }
  setInactive($('spin-save'), state === 'saving');
  setInactive($('spin-retake'), state === 'saving');
}

handleQuickTaps($('spin-controls'), (button) => {
  const auto = spinSettings.mode === 'auto';
  if (button.id === 'spin-extra') {
    if (spinState === 'capturing') {
      if (auto) {
        snapSpinFrame();
      } else {
        finishSpinCapture();
      }
    }
    return;
  }
  // The main button. A double tap must not start and then stop at once.
  if (Date.now() - spinGoChangedAt < SPIN_TAP_PAUSE_MS) {
    return;
  }
  if (spinState === 'off') {
    startSpinCamera();
  } else if (spinState === 'ready') {
    spinFrames = [];
    requestSpinWakeLock();
    if (auto) {
      startSpinCountdown();
    } else {
      spinState = 'capturing';
      snapSpinFrame();
      drawSpinControls();
    }
  } else if (spinState === 'countdown') {
    clearTimeout(spinTimer);
    releaseSpinWakeLock();
    spinState = 'ready';
    drawSpinControls();
  } else if (spinState === 'capturing') {
    if (auto) {
      finishSpinCapture();
    } else {
      snapSpinFrame();
    }
  }
});

// 3, 2, 1, then a picture every few seconds.
function startSpinCountdown() {
  spinState = 'countdown';
  drawSpinControls();
  let count = 3;
  const tick = () => {
    if (spinState !== 'countdown') {
      return;
    }
    if (count === 0) {
      $('spin-big').hidden = true;
      spinState = 'capturing';
      drawSpinControls();
      autoSnap();
      return;
    }
    $('spin-big').textContent = String(count);
    $('spin-big').hidden = false;
    count--;
    spinTimer = setTimeout(tick, 1000);
  };
  tick();
}

// The next picture is timed from the start of this one. If saving a
// picture is slow, the next one waits for it (they never pile up).
function autoSnap() {
  if (spinState !== 'capturing') {
    return;
  }
  const started = Date.now();
  snapSpinFrame().then(() => {
    if (spinState === 'capturing') {
      spinTimer = setTimeout(autoSnap, Math.max(0, spinSettings.interval - (Date.now() - started)));
    }
  });
}

function snapSpinFrame() {
  const flash = $('spin-flash');
  flash.classList.remove('flash');
  void flash.offsetWidth; // restarts the flash animation
  flash.classList.add('flash');
  spinGrabs = spinGrabs
    .then(async () => {
      const taking = spinState === 'capturing' || spinState === 'finishing';
      if (!taking || spinFrames.length >= spinSettings.target) {
        return;
      }
      const blob = await grabFrame(spinVideo);
      if (!blob) {
        setText('spin-status', 'No picture from the camera yet. Wait a moment and try again.', 'bad');
        return;
      }
      spinFrames.push(blob);
      setText('spin-status', '');
      drawSpinControls();
      if (spinFrames.length >= spinSettings.target && spinState === 'capturing') {
        finishSpinCapture(); // not awaited: it waits for this picture to finish
      }
    })
    .catch((err) => setText('spin-status', 'Could not take a picture: ' + err.message, 'bad'));
  return spinGrabs;
}

async function finishSpinCapture() {
  if (spinState === 'countdown') {
    clearTimeout(spinTimer);
    spinState = document.hidden ? 'off' : 'ready';
    if (document.hidden) {
      stopSpinCamera();
    }
    releaseSpinWakeLock();
    return drawSpinControls();
  }
  if (spinState !== 'capturing') {
    return;
  }
  clearTimeout(spinTimer);
  spinState = 'finishing';
  drawSpinControls();
  await spinGrabs; // let a picture being taken finish
  if (spinState !== 'finishing') {
    return; // left the screen meanwhile
  }
  releaseSpinWakeLock();
  freeFrameCanvas();
  if (spinFrames.length < SPIN_MIN_FRAMES) {
    spinFrames = [];
    if (document.hidden) {
      stopSpinCamera();
      spinState = 'off';
    } else {
      spinState = 'ready';
    }
    setText('spin-status', 'A spin needs at least ' + SPIN_MIN_FRAMES + ' pictures. Try again.', 'bad');
    return drawSpinControls();
  }
  stopSpinCamera();
  spinState = 'review';
  await showSpinReview();
}

// ---------- Checking a new spin before saving ----------

async function showSpinReview() {
  drawSpinControls();
  const url = newUrlGroup('spin-review');
  spinFrameUrls = spinFrames.map(url);
  $('spin-first').src = spinFrameUrls[0];
  const trim = $('spin-trim');
  trim.min = String(SPIN_MIN_FRAMES);
  trim.max = String(spinFrames.length);
  trim.value = String(spinFrames.length);
  setText('spin-review-status', 'Loading…');
  try {
    const loaded = await reviewPlayer.load(spinFrames, (done, total) => {
      setText('spin-review-status', 'Loading ' + done + ' / ' + total + '…');
    });
    if (!loaded) {
      return;
    }
  } catch (err) {
    setText('spin-review-status', 'Could not show the spin: ' + err.message, 'bad');
    return;
  }
  setText('spin-review-status', '');
  drawSpinTrim();
  reviewPlayer.show(0);
  reviewPlayer.play();
}

function drawSpinTrim() {
  const last = Number($('spin-trim').value);
  reviewPlayer.setLength(last);
  $('spin-trim-text').textContent = 'Last picture: ' + last + ' of ' + spinFrames.length;
  $('spin-last').src = spinFrameUrls[last - 1];
}

$('spin-trim').addEventListener('input', () => {
  reviewPlayer.stop();
  drawSpinTrim();
  reviewPlayer.show(Number($('spin-trim').value) - 1);
});

$('spin-retake').addEventListener('click', () => {
  if (spinState !== 'review') {
    return;
  }
  leaveSpinCapture();
  setText('spin-status', '');
  drawSpinControls();
  startSpinCamera();
});

$('spin-save').addEventListener('click', async () => {
  if (spinState !== 'review') {
    return;
  }
  spinState = 'saving';
  reviewPlayer.stop();
  drawSpinControls();
  setText('spin-review-status', 'Saving…');
  const frames = spinFrames.slice(0, Number($('spin-trim').value));
  try {
    const first = await loadImage(frames[0]);
    const thumb = await shrinkImage(first, THUMB_LONG_EDGE, THUMB_QUALITY);
    await saveQueue;
    const id = await db.spins.add({
      miniatureId: spinMini.id,
      takenAt: Date.now(),
      frames,
      thumb: thumb.blob,
      width: first.naturalWidth,
      height: first.naturalHeight,
      stage: spinMini.stage,
      note: '',
      reverse: false,
    });
    goTo('#/spin/' + id);
  } catch (err) {
    spinState = 'review';
    drawSpinControls();
    setText('spin-review-status', 'Could not save: ' + err.name + ' - ' + err.message, 'bad');
  }
});

// ---------- Watching a 360° spin ----------

const viewPlayer = createSpinPlayer($('spin-view-stage'), $('spin-view-canvas'), $('spin-play'));

// A quick double tap on a spin must not zoom the page (the spin has no
// buttons, so taps do nothing else). Drags move further and are not affected.
handleQuickTaps($('spin-view-stage'), () => {});
handleQuickTaps($('spin-review-stage'), () => {});
let viewerSpin = null;
let viewerSpinMini = null;

for (const stage of STAGES) {
  const option = el('option', '', stage.label);
  option.value = stage.key;
  $('spin-stage').append(option);
}

async function showSpin(spinId) {
  const spin = await db.spins.get(spinId);
  if (!spin) {
    return goTo('#/');
  }
  viewerSpin = spin;
  viewerSpinMini = await db.miniatures.get(spin.miniatureId);
  $('spin-back').href = '#/mini/' + spin.miniatureId;
  $('spin-back').textContent = '‹ ' + (viewerSpinMini ? viewerSpinMini.name : 'Back');
  $('spin-reverse').checked = Boolean(spin.reverse);
  viewPlayer.reverse = Boolean(spin.reverse);
  drawSpinDetails();
  setText('spin-form-status', '');
  showScreen('spin');

  const loading = $('spin-view-loading');
  loading.textContent = 'Loading…';
  loading.hidden = false;
  try {
    const loaded = await viewPlayer.load(spin.frames, (done, total) => {
      loading.textContent = 'Loading ' + done + ' / ' + total + '…';
    });
    if (loaded) {
      loading.hidden = true;
    }
  } catch (err) {
    loading.textContent = 'Could not show the spin: ' + err.message;
  }
}

function drawSpinDetails() {
  const spin = viewerSpin;
  const meta = $('spin-meta');
  meta.replaceChildren(el('span', '', formatDate(spin.takenAt) + ' · ' + plural(spin.frames.length, 'picture') + ' '));
  if (spin.stage) {
    meta.append(stageBadge(spin.stage));
  }
  $('spin-date').value = dateFieldValue(spin.takenAt);
  $('spin-stage').value = spin.stage || 'sprue';
  $('spin-note').value = spin.note || '';
}

$('spin-reverse').addEventListener('change', async () => {
  const reverse = $('spin-reverse').checked;
  viewPlayer.reverse = reverse;
  viewerSpin.reverse = reverse;
  await db.spins.update(viewerSpin.id, { reverse });
});

$('spin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('spin-date').value) {
    return;
  }
  const changes = {
    takenAt: withDate(viewerSpin.takenAt, $('spin-date').value),
    stage: $('spin-stage').value,
    note: $('spin-note').value.trim(),
  };
  await db.spins.update(viewerSpin.id, changes);
  Object.assign(viewerSpin, changes);
  drawSpinDetails();
  setText('spin-form-status', 'Saved.', 'ok');
});

// The picture showing right now becomes a progress photo.
$('spin-to-photo').addEventListener('click', async () => {
  if (!viewPlayer.length) {
    return;
  }
  const number = viewPlayer.index + 1;
  const blob = viewerSpin.frames[viewPlayer.index];
  try {
    const img = await loadImage(blob);
    const thumb = await shrinkImage(img, THUMB_LONG_EDGE, THUMB_QUALITY);
    await db.photos.add({
      miniatureId: viewerSpin.miniatureId,
      takenAt: viewerSpin.takenAt,
      blob,
      thumb: thumb.blob,
      width: img.naturalWidth,
      height: img.naturalHeight,
      stage: viewerSpin.stage,
      note: '',
    });
    setText('spin-form-status', 'Picture ' + number + ' saved as a progress photo.', 'ok');
  } catch (err) {
    setText('spin-form-status', 'Could not save the photo: ' + err.message, 'bad');
  }
});

$('spin-delete').addEventListener('click', async () => {
  if (!confirm('Delete this spin? This cannot be undone.')) {
    return;
  }
  await db.spins.delete(viewerSpin.id);
  goTo('#/mini/' + viewerSpin.miniatureId);
});

// ---------- Shopping list ----------
// Paints to buy: every paint used in a colour scheme that is not owned,
// plus paints added by hand (onList), e.g. owned paints that are running low.

// Build the list. With an army id, only that army's schemes count
// (paints added by hand are always included).
async function shoppingList(armyId) {
  const [paints, armies, schemes, steps] = await Promise.all([
    db.paints.toArray(), db.armies.toArray(), db.schemes.toArray(), db.schemeSteps.toArray(),
  ]);
  const armyNames = new Map(armies.map((a) => [a.id, a.name]));
  const schemesById = new Map(schemes.map((s) => [s.id, s]));
  const items = new Map(); // paint id -> { paint, reasons }

  function itemFor(paint) {
    if (!items.has(paint.id)) {
      items.set(paint.id, { paint, reasons: new Set() });
    }
    return items.get(paint.id);
  }

  const paintsById = new Map(paints.map((p) => [p.id, p]));
  for (const step of steps) {
    const paint = paintsById.get(step.paintId);
    const scheme = schemesById.get(step.schemeId);
    if (!paint || paint.owned || !scheme || (armyId && scheme.armyId !== armyId)) {
      continue;
    }
    itemFor(paint).reasons.add(scheme.name + ' · ' + (armyNames.get(scheme.armyId) || 'unknown army'));
  }
  for (const paint of paints) {
    if (paint.onList) {
      itemFor(paint).reasons.add(paint.owned ? 'Restock' : 'Added by hand');
    }
  }
  return [...items.values()]
    .map((item) => ({ paint: item.paint, reasons: [...item.reasons] }))
    .sort((a, b) => rangeIndex(a.paint.range) - rangeIndex(b.paint.range) ||
      (a.paint.range || '').localeCompare(b.paint.range || '') ||
      a.paint.name.localeCompare(b.paint.name));
}

// The number on the Shop link in the top bar.
async function updateShopCount() {
  const count = (await shoppingList(null)).length;
  $('shop-count').textContent = count;
  $('shop-count').hidden = count === 0;
}

let shopItems = [];
let shopBought = new Map(); // paint id -> what it was before ticking (for undo)
let shopPaints = [];

async function showShop() {
  const armies = await db.armies.orderBy('createdAt').toArray();
  const select = $('shop-army');
  const chosen = select.value;
  const all = el('option', '', 'All armies');
  all.value = '';
  select.replaceChildren(all, ...armies.map((army) => {
    const option = el('option', '', army.name);
    option.value = army.id;
    return option;
  }));
  select.value = armies.some((a) => String(a.id) === chosen) ? chosen : '';

  shopBought = new Map();
  shopItems = await shoppingList(Number(select.value) || null);
  shopPaints = await db.paints.toArray();
  $('shop-add').hidden = true;
  $('shop-add-open').hidden = false;
  $('shop-share-status').textContent = '';
  $('shop-share-text').hidden = true;
  drawShop();
  showScreen('shop');
}

$('shop-army').addEventListener('change', async () => {
  shopItems = await shoppingList(Number($('shop-army').value) || null);
  drawShop();
});

function drawShop() {
  const box = $('shop-list');
  box.replaceChildren();
  let list = null;
  let range = null;
  for (const { paint, reasons } of shopItems) {
    if (paint.range !== range || !list) {
      range = paint.range;
      box.append(el('h3', 'shop-range', range || 'Other'));
      list = el('ul', 'list');
      box.append(list);
    }
    const bought = shopBought.has(paint.id);
    const item = el('li', 'paint-row shop-row' + (bought ? ' bought' : ''));
    const text = el('div', 'list-item');
    text.append(paintSwatch(paint));
    const words = el('div', 'list-text');
    words.append(el('div', 'list-title', paint.name));
    words.append(el('div', 'list-sub', reasons.join(', ')));
    text.append(words);

    const toggle = el('button', 'owned-toggle' + (bought ? ' owned' : ''), bought ? '✓' : '○');
    toggle.dataset.toggle = paint.id;
    toggle.setAttribute('aria-pressed', bought ? 'true' : 'false');
    toggle.setAttribute('aria-label', (bought ? 'Bought: ' : 'Mark as bought: ') + paint.name);
    item.append(text, toggle);
    list.append(item);
  }
  const left = shopItems.length - shopBought.size;
  $('shop-empty').hidden = shopItems.length > 0;
  $('shop-summary').textContent = shopItems.length
    ? left + ' to buy' + (shopBought.size ? ', ' + shopBought.size + ' ticked off' : '') + '. Tap ○ when you buy a paint; tap ✓ to undo.'
    : '';
  $('shop-share').hidden = left === 0;
}

// Tick a paint off (it becomes owned and leaves the hand-added list), or undo.
handleQuickTaps($('shop-list'), (button) => {
  const id = Number(button.dataset.toggle);
  const item = shopItems.find((i) => i.paint.id === id);
  if (!item) {
    return;
  }
  const paint = item.paint;
  let changes;
  if (shopBought.has(id)) {
    changes = shopBought.get(id); // undo: put back what it was
    shopBought.delete(id);
  } else {
    shopBought.set(id, { owned: Boolean(paint.owned), onList: Boolean(paint.onList) });
    changes = { owned: true, onList: false };
  }
  Object.assign(paint, changes);
  drawShop();
  queueSave(() => db.paints.update(id, changes));
  queueSave(updateShopCount);
});

// ---------- Sharing the list ----------

function shoppingListText() {
  const lines = ['Paint shopping list'];
  let range = null;
  for (const { paint } of shopItems) {
    if (shopBought.has(paint.id)) {
      continue;
    }
    if (paint.range !== range) {
      range = paint.range;
      lines.push(range || 'Other');
    }
    lines.push('- ' + paint.name);
  }
  return lines.join('\n');
}

$('shop-share').addEventListener('click', () => {
  shareText('Paint shopping list', shoppingListText(), 'shop-share-status', 'shop-share-text');
});

// Share text with the share sheet (e.g. to Notes or Messages). Falls back to
// copying it, and as a last resort shows it in a box to copy by hand.
async function shareText(title, text, statusId, boxId) {
  $(boxId).hidden = true;
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      setText(statusId, '');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      setText(statusId, 'Copied. Paste it into Notes or a message.', 'ok');
      return;
    }
    throw new Error('Sharing is not available here.');
  } catch (err) {
    if (err.name === 'AbortError') {
      return; // the share sheet was closed
    }
    $(boxId).value = text;
    $(boxId).hidden = false;
    setText(statusId, 'Could not share (' + err.message.replace(/\.$/, '') + '). Select and copy the text below.', 'bad');
  }
}

// ---------- Adding paints by hand ----------

$('shop-add-open').addEventListener('click', () => {
  $('shop-add').hidden = false;
  $('shop-add-open').hidden = true;
  $('shop-search').value = '';
  drawShopResults();
  $('shop-search').focus();
});

function drawShopResults() {
  const query = $('shop-search').value.trim();
  const list = $('shop-results');
  list.replaceChildren();
  if (!query) {
    $('shop-search-note').textContent = 'Type part of a paint name. Owned paints can be added too, to restock them.';
    return [];
  }
  const onList = new Set(shopItems.map((i) => i.paint.id));
  const found = filterPaints(shopPaints, query, {}).filter((p) => !onList.has(p.id));
  for (const paint of found.slice(0, MAX_PAINT_RESULTS)) {
    const button = el('button', 'list-item paint-result');
    button.type = 'button';
    button.append(paintSwatch(paint));
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', paintLabel(paint)));
    text.append(el('div', 'list-sub', paint.owned ? 'Owned (add to restock)' : 'Not owned'));
    button.append(text);
    button.addEventListener('click', () => addToShoppingList(paint));
    const item = el('li');
    item.append(button);
    list.append(item);
  }
  let note = found.length === 0 ? 'No paints match, or they are already on the list.' : '';
  if (found.length > MAX_PAINT_RESULTS) {
    note = 'Showing ' + MAX_PAINT_RESULTS + ' of ' + found.length + '. Keep typing to narrow it down.';
  }
  $('shop-search-note').textContent = note;
  return found;
}

async function addToShoppingList(paint) {
  await saveQueue;
  await db.paints.update(paint.id, { onList: true });
  paint.onList = true;
  shopItems = await shoppingList(Number($('shop-army').value) || null);
  $('shop-search').value = '';
  $('shop-search').blur();
  $('shop-add').hidden = true;
  $('shop-add-open').hidden = false;
  drawShop();
  updateShopCount();
}

$('shop-search').addEventListener('input', drawShopResults);
$('shop-search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const found = drawShopResults();
  if (found.length === 1) {
    addToShoppingList(found[0]);
  } else {
    $('shop-search').blur();
  }
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

// ---------- Army lists: shared helpers ----------

// The army's units from the unit list, as a lookup by name. Empty if the army
// has no faction or the unit list can't be loaded (saved points are used then).
async function armyUnits(army) {
  try {
    return unitMap(await unitsForFaction(army.factionId));
  } catch (err) {
    return new Map();
  }
}

async function entriesOfList(listId) {
  const entries = await db.listEntries.where('listId').equals(listId).toArray();
  return entries.sort((a, b) => a.order - b.order);
}

// "1,240 / 2,000 pts"
function pointsOfLimit(total, limit) {
  return formatPoints(total) + ' / ' + formatPoints(limit) + ' pts';
}

// "760 pts left" or "Over by 85 pts"
function pointsLeft(total, limit) {
  if (total > limit) {
    return 'Over by ' + formatPoints(total - limit) + ' pts';
  }
  return total === limit ? 'Exactly at the limit' : formatPoints(limit - total) + ' pts left';
}

// A date like '2026-09-30' as "30 Sep 2026"
function formatDay(text) {
  const [year, month, day] = text.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day));
}

// The army's lists on the army screen, with their points.
async function drawArmyLists(army) {
  const lists = await db.lists.where('armyId').equals(army.id).sortBy('createdAt');
  const units = lists.length ? await armyUnits(army) : new Map();
  const box = $('army-lists');
  box.replaceChildren();
  for (const list of lists) {
    const entries = await entriesOfList(list.id);
    const { total } = priceList(entries, units);
    const link = el('a', 'list-item');
    link.href = '#/list/' + list.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', list.name));
    const sub = el('div', 'list-sub');
    sub.append(el('span', total > list.pointsLimit ? 'bad' : '', pointsOfLimit(total, list.pointsLimit)));
    sub.append(' · ' + plural(entries.length, 'unit'));
    text.append(sub);
    link.append(text, el('span', 'chevron', '›'));
    const item = el('li');
    item.append(link);
    box.append(item);
  }
  $('army-lists-empty').hidden = lists.length > 0;
  $('list-new').href = '#/list/new/' + army.id;
}

// Everything the list screens need, kept in memory so taps redraw instantly.
let currentList = null;
let currentListArmy = null;
let currentEntries = [];
let listUnits = new Map();
let listSquads = [];

// Load a list and its army. Returns false if either no longer exists.
async function loadList(listId) {
  const list = await db.lists.get(listId);
  const army = list && await db.armies.get(list.armyId);
  if (!army) {
    return false;
  }
  currentList = list;
  currentListArmy = army;
  currentEntries = await entriesOfList(listId);
  listUnits = await armyUnits(army);
  listSquads = await db.miniatures.where('armyId').equals(army.id).sortBy('createdAt');
  return true;
}

function rowOf(entry) {
  return priceList(currentEntries, listUnits).rows.find((row) => row.entry === entry);
}

// Add a unit to the current list. The screen can update straight away;
// saving is queued (see queueSave).
function addEntry(fields) {
  const order = currentEntries.reduce((max, e) => Math.max(max, e.order || 0), 0) + 1;
  const entry = { listId: currentList.id, name: fields.name, unitName: fields.unitName || null,
    models: fields.models, points: fields.points || 0, extraPoints: 0, order };
  currentEntries.push(entry);
  const row = rowOf(entry);
  entry.points = row.base; // saved in case the unit later goes missing from the points data
  queueSave(async () => {
    entry.id = await db.listEntries.add({ ...entry });
  });
  return row;
}

// ---------- Army list form ----------

let editingList = null;

async function showListForm(listId, armyId) {
  let list = { name: '', pointsLimit: 2000, armyId };
  if (listId) {
    list = await db.lists.get(listId);
  }
  const army = list && await db.armies.get(list.armyId);
  if (!army) {
    return goTo('#/');
  }
  editingList = list;
  $('list-form-title').textContent = listId ? 'Edit army list' : 'New army list';
  $('list-form-back').href = listId ? '#/list/' + listId : '#/army/' + army.id;
  $('list-name').value = list.name;
  $('list-limit').value = list.pointsLimit;
  showScreen('list-form');
}

$('list-limit-choices').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) {
    $('list-limit').value = button.dataset.limit;
  }
});

$('list-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('list-name').value.trim();
  const pointsLimit = Math.round(Number($('list-limit').value));
  if (!name || !(pointsLimit >= 1)) {
    return;
  }
  let id = editingList.id;
  if (id) {
    await db.lists.update(id, { name, pointsLimit });
  } else {
    id = await db.lists.add({ armyId: editingList.armyId, name, pointsLimit, createdAt: Date.now() });
  }
  goTo('#/list/' + id);
});

// ---------- One army list ----------

async function showList(listId) {
  if (!(await loadList(listId))) {
    return goTo('#/');
  }
  setText('list-share-status', '');
  $('list-share-text').hidden = true;

  let note = '';
  if (!currentListArmy.factionId) {
    note = 'This army has no faction picked, so units are typed by hand with their points. Pick a faction (Edit army) to search units with their points.';
  } else {
    try {
      const catalogue = await loadCatalogue();
      note = 'Points: Munitorum Field Manual data ' + catalogue.dataVersion + ', ' + formatDay(catalogue.dataUpdated) +
        '. Check the points book for later changes.';
    } catch (err) {
      note = 'The points data could not be loaded, so saved points are shown.';
    }
  }
  $('list-data-note').textContent = note;
  drawList();
  showScreen('list');
}

// Draw the list screen from memory (no database reading), so it keeps up with quick taps.
function drawList() {
  const list = currentList;
  const army = currentListArmy;
  const { rows, total } = priceList(currentEntries, listUnits);
  const owned = matchOwned(currentEntries, listSquads);
  const over = total > list.pointsLimit;

  $('list-back').href = '#/army/' + army.id;
  $('list-back').textContent = '‹ ' + army.name;
  $('list-title').textContent = list.name;
  const models = currentEntries.reduce((sum, e) => sum + e.models, 0);
  $('list-army-text').textContent = currentEntries.length ? plural(currentEntries.length, 'unit') + ' · ' + plural(models, 'model') : '';

  setText('list-total', formatPoints(total) + ' pts', over ? 'bad' : null);
  $('list-limit-text').textContent = 'of ' + formatPoints(list.pointsLimit);
  $('list-bar').style.width = Math.min(100, (total / list.pointsLimit) * 100) + '%';
  $('list-bar').classList.toggle('over', over);
  setText('list-left', pointsLeft(total, list.pointsLimit), over ? 'bad' : null);

  const ready = [...owned.values()].filter(isBattleReady).length;
  $('list-owned').textContent = currentEntries.length
    ? 'Owned: ' + owned.size + ' of ' + plural(currentEntries.length, 'unit') + ' · Battle-ready: ' + ready
    : '';

  const box = $('list-entries');
  box.replaceChildren(...rows.map((row) => entryRow(row, owned.get(row.entry))));
  $('list-empty').hidden = rows.length > 0;
  $('list-tip').hidden = rows.length === 0;
  $('list-add').href = '#/list/' + list.id + '/add';
  $('list-edit').href = '#/list/' + list.id + '/edit';
}

// One unit in the list: name and details (tap to open), points, and
// buttons to change the squad size.
function entryRow(row, squad) {
  const entry = row.entry;
  const item = el('li', 'entry-row');

  const open = el('button', 'entry-text');
  open.dataset.open = entry.id;
  open.append(el('div', 'list-title', entry.name));
  const details = [plural(entry.models, 'model')];
  if (row.higherCopy) {
    details.push(ordinal(row.copy) + ' copy: higher cost');
  }
  if (row.extra) {
    details.push('+' + formatPoints(row.extra) + ' extra');
  }
  if (!row.unit) {
    details.push(entry.unitName ? 'saved points' : 'typed by hand');
  }
  open.append(el('div', 'list-sub', details.join(' · ')));
  const status = el('div', 'entry-status');
  if (squad) {
    status.append(stageBadge(squad.stage));
    const have = modelCountOf(squad);
    if (have < entry.models) {
      status.append(el('span', 'list-sub', 'own ' + have + ' of ' + entry.models));
    }
  } else {
    status.append(el('span', 'not-owned', 'Not owned'));
  }
  open.append(status);

  const buttons = el('div', 'step-buttons size-buttons');
  const sizes = row.unit ? row.unit.sizes : [];
  const i = sizes.indexOf(entry.models);
  if (sizes.length > 1 && i !== -1) {
    const smaller = el('button', 'small secondary', '−');
    smaller.setAttribute('aria-label', 'Fewer models in ' + entry.name);
    const bigger = el('button', 'small secondary', '+');
    bigger.setAttribute('aria-label', 'More models in ' + entry.name);
    smaller.dataset.resize = bigger.dataset.resize = entry.id;
    smaller.dataset.direction = '-1';
    bigger.dataset.direction = '1';
    setInactive(smaller, i === 0);
    setInactive(bigger, i === sizes.length - 1);
    buttons.append(smaller, bigger);
  }

  item.append(open, el('div', 'entry-points', formatPoints(row.points)), buttons);
  return item;
}

handleQuickTaps($('list-entries'), (button) => {
  if (button.dataset.open) {
    location.hash = '#/entry/' + button.dataset.open;
  } else if (button.dataset.resize) {
    resizeEntry(Number(button.dataset.resize), Number(button.dataset.direction));
  }
});

// Move a unit to the next squad size up or down.
function resizeEntry(entryId, direction) {
  const entry = currentEntries.find((e) => e.id === entryId);
  const unit = entry && listUnits.get(entry.unitName);
  if (!unit) {
    return;
  }
  const i = unit.sizes.indexOf(entry.models);
  const size = unit.sizes[i + direction];
  if (i === -1 || size === undefined) {
    return;
  }
  entry.models = size;
  entry.points = rowOf(entry).base;
  drawList();
  const fields = { models: entry.models, points: entry.points };
  queueSave(() => db.listEntries.update(entryId, fields));
}

$('list-share').addEventListener('click', () => {
  const { rows, total } = priceList(currentEntries, listUnits);
  const text = listText(currentList, currentListArmy.name, rows, total);
  shareText(currentList.name, text, 'list-share-status', 'list-share-text');
});

$('list-duplicate').addEventListener('click', async () => {
  await saveQueue;
  const id = await duplicateList(currentList.id);
  goTo('#/list/' + id);
});

$('list-delete').addEventListener('click', async () => {
  if (!confirm('Delete the list "' + currentList.name + '"? Your miniatures are not affected.')) {
    return;
  }
  await saveQueue;
  await deleteList(currentList.id);
  goTo('#/army/' + currentList.armyId);
});

// ---------- Adding units to a list ----------

let listSearchUnits = [];

async function showListAdd(listId) {
  if (!(await loadList(listId))) {
    return goTo('#/');
  }
  $('list-add-back').href = '#/list/' + listId;
  $('list-add-back').textContent = '‹ ' + currentList.name;
  setText('list-add-status', 'Tap a unit to add it to the list.');

  listSearchUnits = [...listUnits.values()];
  let offNote = '';
  if (!currentListArmy.factionId) {
    offNote = 'Tip: pick a faction for this army (Edit army) to search its units with their points. Until then, add units by hand below.';
  } else if (!listSearchUnits.length) {
    offNote = 'The unit list could not be loaded. Units can still be added by hand below.';
  }
  $('list-search-box').hidden = !listSearchUnits.length;
  $('list-search-off').textContent = offNote;
  $('list-search-off').hidden = !offNote;
  $('list-search').value = '';
  drawListResults();

  $('hand-name').value = '';
  $('hand-models').value = 1;
  $('hand-points').value = '';
  drawAddSummary();
  drawOwnedSquads();
  showScreen('list-add');
}

// The list's total at the top of the add screen (it stays in view while scrolling).
function drawAddSummary() {
  const { total } = priceList(currentEntries, listUnits);
  const limit = currentList.pointsLimit;
  setText('list-add-total', pointsOfLimit(total, limit) + ' · ' + pointsLeft(total, limit), total > limit ? 'bad' : null);
}

function showAdded(row, extraNote) {
  const entry = row.entry;
  let text = 'Added ' + entry.name + ' (' + plural(entry.models, 'model') + ', ' + formatPoints(row.points) + ' pts)';
  if (row.higherCopy) {
    text += ', ' + ordinal(row.copy) + ' copy costs more';
  }
  setText('list-add-status', text + '.' + (extraNote ? ' ' + extraNote : ''), 'ok');
  drawAddSummary();
  drawListResults();
  drawOwnedSquads();
}

// "5 models: 95 pts, 10 models: 175 pts" for the next copy of a unit
function describePrices(unit, copy) {
  return unit.sizes.map((size) => {
    const price = priceOf(unit, copy, size);
    return plural(size, 'model') + (price === null ? '' : ': ' + formatPoints(price) + ' pts');
  }).join(', ');
}

function drawListResults() {
  const query = $('list-search').value.trim();
  const list = $('list-results');
  list.replaceChildren();
  if (!query) {
    $('list-search-note').textContent = 'Search ' + listSearchUnits.length + ' ' + (currentListArmy.faction || '') +
      ' units. Tap a unit to add it; tap again to add another copy.';
    return;
  }
  const found = searchUnits(listSearchUnits, query);
  for (const unit of found.slice(0, MAX_RESULTS)) {
    const inList = currentEntries.filter((e) => e.unitName === unit.name).length;
    const button = el('button', 'list-item unit-result');
    button.type = 'button';
    button.dataset.add = unit.name;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', unit.name));
    text.append(el('div', 'list-sub', describePrices(unit, inList + 1)));
    const owned = ownedOf(unit.name, listSquads);
    const notes = [unit.group, owned ? 'You own ' + owned : '', inList ? 'In this list: ' + inList : ''].filter(Boolean);
    if (notes.length) {
      text.append(el('div', 'list-sub', notes.join(' · ')));
    }
    button.append(text);
    if (unit.legends) {
      button.append(el('span', 'badge legends', 'Legends'));
    }
    const item = el('li');
    item.append(button);
    list.append(item);
  }
  let note = found.length === 0 ? 'No units match. You can type the unit in by hand below.' : '';
  if (found.length > MAX_RESULTS) {
    note = 'Showing ' + MAX_RESULTS + ' of ' + found.length + '. Keep typing to narrow it down.';
  }
  $('list-search-note').textContent = note;
}

$('list-search').addEventListener('input', drawListResults);

// The keyboard's Search/Enter key: if exactly one unit matches, add it;
// otherwise just close the keyboard.
$('list-search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const query = $('list-search').value.trim();
  const found = query ? searchUnits(listSearchUnits, query) : [];
  if (found.length === 1) {
    addUnit(found[0]);
  }
  $('list-search').blur();
});

handleQuickTaps($('list-results'), (button) => {
  const unit = listUnits.get(button.dataset.add);
  if (unit) {
    $('list-search').blur();
    addUnit(unit);
  }
});

function addUnit(unit) {
  showAdded(addEntry({ unitName: unit.name, name: unit.name, models: unit.sizes[0] || 1 }));
}

// The army's squads, to add to the list in one tap.
function drawOwnedSquads() {
  const inList = new Set(matchOwned(currentEntries, listSquads).values());
  const list = $('list-owned-units');
  list.replaceChildren();
  for (const squad of listSquads) {
    const button = el('button', 'list-item unit-result');
    button.type = 'button';
    button.dataset.squad = squad.id;
    const text = el('div', 'list-text');
    text.append(el('div', 'list-title', squad.name));
    text.append(el('div', 'list-sub', plural(modelCountOf(squad), 'model') + (inList.has(squad) ? ' · in this list' : '')));
    button.append(text, stageBadge(squad.stage));
    const item = el('li');
    item.append(button);
    list.append(item);
  }
  $('list-owned-empty').hidden = listSquads.length > 0;
}

handleQuickTaps($('list-owned-units'), (button) => {
  const squad = listSquads.find((s) => s.id === Number(button.dataset.squad));
  if (squad) {
    addSquad(squad);
  }
});

// Add an owned squad. Its unit is found by the unit picked when it was added,
// or else by its name. Without a match, the hand-typed form is filled in.
function addSquad(squad) {
  const key = nameKey(squad.unitName || squad.name);
  const unit = listUnits.get(squad.unitName) || listSearchUnits.find((u) => nameKey(u.name) === key);
  const have = modelCountOf(squad);
  if (!unit) {
    $('hand-name').value = squad.name;
    $('hand-models').value = have;
    $('hand-points').value = '';
    setText('list-add-status', '"' + squad.name + '" was not found in the points data. Enter its points under "Type by hand".', 'bad');
    $('list-hand-form').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const models = fitSize(unit, have);
  const note = models === have ? '' : 'Your squad has ' + have + ' models; the list uses the nearest size, ' + models + '.';
  showAdded(addEntry({ unitName: unit.name, name: unit.name, models }), note);
}

$('list-hand-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('hand-name').value.trim();
  const models = Math.round(Number($('hand-models').value));
  const points = Math.round(Number($('hand-points').value));
  if (!name || !(models >= 1) || !(points >= 0) || $('hand-points').value === '') {
    return;
  }
  showAdded(addEntry({ unitName: null, name, models, points }));
  $('hand-name').value = '';
  $('hand-models').value = 1;
  $('hand-points').value = '';
  document.activeElement.blur();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- One unit in a list ----------

let currentEntry = null;

async function showEntry(entryId) {
  const saved = await db.listEntries.get(entryId);
  if (!saved || !(await loadList(saved.listId))) {
    return goTo('#/');
  }
  const entry = currentEntries.find((e) => e.id === entryId);
  const row = rowOf(entry);
  currentEntry = entry;

  $('entry-back').href = '#/list/' + currentList.id;
  $('entry-back').textContent = '‹ ' + currentList.name;
  $('entry-title').textContent = entry.name;
  let about = 'Typed by hand.';
  if (row.unit) {
    about = 'Points data: ' + row.unit.name + (row.copy > 1 ? ' · ' + ordinal(row.copy) + ' copy in this list' : '');
  } else if (entry.unitName) {
    about = '"' + entry.unitName + '" has no points for this squad size in the data for this army, so the saved points are used.';
  }
  $('entry-unit-text').textContent = about;
  $('entry-name').value = entry.name;

  // Units from the points data pick a squad size; others type models and points.
  const select = $('entry-size');
  if (row.unit) {
    select.replaceChildren(...row.unit.sizes.map((size) => {
      const price = priceOf(row.unit, row.copy, size);
      const option = el('option', '', plural(size, 'model') + (price === null ? '' : ': ' + formatPoints(price) + ' pts'));
      option.value = size;
      return option;
    }));
    select.value = entry.models;
  }
  $('entry-size-label').hidden = !row.unit;
  $('entry-models-label').hidden = Boolean(row.unit);
  $('entry-points-label').hidden = Boolean(row.unit);
  $('entry-models').value = entry.models;
  $('entry-points').value = entry.points;
  $('entry-extra').value = entry.extraPoints || '';
  showScreen('entry');
}

$('entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const entry = currentEntry;
  const fromData = !$('entry-size-label').hidden;
  const name = $('entry-name').value.trim();
  const models = Math.round(Number(fromData ? $('entry-size').value : $('entry-models').value));
  const points = Math.round(Number($('entry-points').value));
  const extraPoints = Math.max(0, Math.round(Number($('entry-extra').value) || 0));
  if (!name || !(models >= 1) || (!fromData && !(points >= 0))) {
    return;
  }
  Object.assign(entry, { name, models, extraPoints });
  if (!fromData) {
    entry.points = points;
  }
  entry.points = rowOf(entry).base;
  await db.listEntries.update(entry.id, { name, models, extraPoints, points: entry.points });
  goTo('#/list/' + currentList.id);
});

$('entry-copy').addEventListener('click', () => {
  const entry = currentEntry;
  addEntry({ unitName: entry.unitName, name: entry.name, models: entry.models, points: entry.points });
  goTo('#/list/' + currentList.id);
});

$('entry-remove').addEventListener('click', async () => {
  if (!confirm('Remove "' + currentEntry.name + '" from this list?')) {
    return;
  }
  await db.listEntries.delete(currentEntry.id);
  goTo('#/list/' + currentList.id);
});

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

  let photoCount = 0;
  let photoBytes = 0;
  await db.photos.each((photo) => {
    photoCount++;
    photoBytes += (photo.blob ? photo.blob.size : 0) + (photo.thumb ? photo.thumb.size : 0);
  });
  setText('diag-photos', photoCount ? plural(photoCount, 'photo') + ', ' + formatSize(photoBytes) : 'none yet');

  let spinCount = 0;
  let spinBytes = 0;
  await db.spins.each((spin) => {
    spinCount++;
    spinBytes += (spin.frames || []).reduce((sum, frame) => sum + frame.size, 0) + (spin.thumb ? spin.thumb.size : 0);
  });
  setText('diag-spins', spinCount ? plural(spinCount, 'spin') + ', ' + formatSize(spinBytes) : 'none yet');

  const listCount = await db.lists.count();
  const entryCount = await db.listEntries.count();
  setText('diag-lists', listCount ? plural(listCount, 'list') + ', ' + plural(entryCount, 'unit') + ' in total' : 'none yet');

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

// Turn the cameras off when the app goes into the background.
// A spin being taken stops there, keeping the pictures taken so far.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
    pauseSpinCapture();
    viewPlayer.stop();
    reviewPlayer.stop();
  } else if (!$('screen-spin-capture').hidden && spinState === 'off') {
    startSpinCamera();
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
