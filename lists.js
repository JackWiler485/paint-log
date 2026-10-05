// Army lists: working out points, which list units are owned, and the
// list as plain text for sharing.
// Points come from data/units.json (see units.js). Each unit has "pricing
// tiers": the price of each copy in the list. For example a Castigator's
// 1st and 2nd copies cost 165 each and the 3rd and later copies 185 each.

// Points as text, e.g. "1,240"
function formatPoints(points) {
  return points.toLocaleString('en-GB');
}

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) {
    return n + 'th';
  }
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

// A quick lookup from unit name to unit.
function unitMap(units) {
  const map = new Map();
  for (const unit of units) {
    if (!map.has(unit.name)) {
      map.set(unit.name, unit);
    }
  }
  return map;
}

// Which pricing tier applies to the given copy (1 = the first copy in the list).
function tierFor(unit, copy) {
  return unit.pricing.findIndex(([low, high]) => low <= copy && (high === null || copy <= high));
}

// The points for one copy of a unit at a squad size, or null if the data has
// no price for it.
function priceOf(unit, copy, models) {
  const tier = unit.pricing[tierFor(unit, copy)];
  if (!tier) {
    return null;
  }
  // Some units list the same size twice; the first one is the plain unit.
  const option = tier[2].find(([size]) => size === models);
  return option ? option[1] : null;
}

// The squad size to use for a list entry, given a number of models
// (e.g. from an owned squad): the largest size that fits, else the smallest.
function fitSize(unit, models) {
  const sizes = unit.sizes || [];
  const fitting = sizes.filter((size) => size <= models);
  return fitting.length ? fitting[fitting.length - 1] : sizes[0] || models;
}

// Work out the points of every entry in a list.
// entries: the list's entries, sorted by order.
// units: a unitMap of the army's units (may be empty).
// Returns one row per entry plus the total.
function priceList(entries, units) {
  const copies = new Map();
  let total = 0;
  const rows = entries.map((entry) => {
    const unit = entry.unitName ? units.get(entry.unitName) : null;
    let copy = 0;
    if (entry.unitName) {
      copy = (copies.get(entry.unitName) || 0) + 1;
      copies.set(entry.unitName, copy);
    }
    const price = unit ? priceOf(unit, copy, entry.models) : null;
    // No price in the data (unit typed by hand, faction changed, data
    // updated): use the points saved with the entry.
    const base = price === null ? (entry.points || 0) : price;
    const extra = entry.extraPoints || 0;
    total += base + extra;
    return {
      entry,
      unit: price === null ? null : unit,
      copy,
      higherCopy: price !== null && tierFor(unit, copy) > 0,
      base,
      extra,
      points: base + extra,
    };
  });
  return { rows, total };
}

// ---------- Owned units ----------
// Each list entry is paired with at most one squad from the army, and each
// squad with at most one entry. So with 2 Intercessor Squads in the list and
// 1 owned, the second shows as not owned.

function nameKey(text) {
  return simplify(text || '').trim();
}

// The most advanced squads are paired first (among those with enough models).
function byReadiness(a, b) {
  return stageIndex(b.stage) - stageIndex(a.stage) || modelCountOf(b) - modelCountOf(a);
}

// Returns a Map from each paired entry to its squad.
function matchOwned(entries, squads) {
  const free = [...squads].sort(byReadiness);
  const matches = new Map();

  // Prefer a squad with enough models for the entry.
  function pair(entry, test) {
    let i = free.findIndex((squad) => test(squad) && modelCountOf(squad) >= entry.models);
    if (i === -1) {
      i = free.findIndex(test);
    }
    if (i !== -1) {
      matches.set(entry, free[i]);
      free.splice(i, 1);
    }
  }

  // First: the same unit from the unit list.
  for (const entry of entries) {
    if (entry.unitName) {
      pair(entry, (squad) => squad.unitName === entry.unitName);
    }
  }
  // Then: the same name, ignoring capitals and apostrophe styles.
  for (const entry of entries) {
    if (!matches.has(entry)) {
      const keys = [nameKey(entry.unitName), nameKey(entry.name)].filter(Boolean);
      pair(entry, (squad) => keys.includes(nameKey(squad.unitName)) || keys.includes(nameKey(squad.name)));
    }
  }
  return matches;
}

// How many squads of a unit the army owns (shown in the search results).
function ownedOf(unitName, squads) {
  const key = nameKey(unitName);
  return squads.filter((squad) => squad.unitName === unitName || nameKey(squad.name) === key).length;
}

// Battle-ready: every model painted or based.
function isBattleReady(squad) {
  return stageIndex(squad.stage) >= stageIndex('painted');
}

// ---------- Sharing ----------

function listText(list, armyName, rows, total) {
  const lines = [list.name + ' (' + formatPoints(total) + ' / ' + formatPoints(list.pointsLimit) + ' pts)'];
  if (armyName) {
    lines.push(armyName);
  }
  lines.push('');
  for (const row of rows) {
    const entry = row.entry;
    const models = entry.models > 1 ? ', ' + entry.models + ' models' : '';
    const extra = row.extra ? ' (incl. ' + formatPoints(row.extra) + ' extra)' : '';
    lines.push('- ' + entry.name + models + ': ' + formatPoints(row.points) + ' pts' + extra);
  }
  lines.push('');
  lines.push('Total: ' + formatPoints(total) + ' pts');
  return lines.join('\n');
}
