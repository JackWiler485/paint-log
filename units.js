// The unit catalogue: every unit name per faction, from data/units.json.
// (That file is built by tools/build-units.py; see data/THIRD-PARTY-NOTICES.md.)

let cataloguePromise = null;

// Load the catalogue once. Later calls reuse the same result.
function loadCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = fetch('data/units.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load the unit list (' + response.status + ').');
        }
        return response.json();
      })
      .catch((err) => {
        cataloguePromise = null; // allow a retry next time
        throw err;
      });
  }
  return cataloguePromise;
}

// The faction choices for the army form, sorted by name.
// Factions with sub-factions (Space Marine chapters) get one extra choice per
// sub-faction, with an id like 'space-marines/ultramarines'.
async function factionChoices() {
  const catalogue = await loadCatalogue();
  const choices = [];
  for (const faction of catalogue.factions) {
    choices.push({ id: faction.id, name: faction.name });
    for (const sub of faction.subfactions || []) {
      choices.push({ id: faction.id + '/' + slugify(sub), name: sub + ' (' + faction.name + ')' });
    }
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// All units an army can pick from.
// For a sub-faction (e.g. Ultramarines): the faction's general units plus that
// sub-faction's own units, leaving out other sub-factions' units.
async function unitsForFaction(factionId) {
  if (!factionId) {
    return [];
  }
  const catalogue = await loadCatalogue();
  const [mainId, subId] = factionId.split('/');
  const faction = catalogue.factions.find((f) => f.id === mainId);
  if (!faction) {
    return [];
  }
  if (!subId) {
    return faction.units;
  }
  const subNames = new Set((faction.subfactions || []).map((sub) => slugify(sub)));
  return faction.units.filter((unit) => {
    if (!unit.group || !subNames.has(slugify(unit.group))) {
      return true; // a general unit
    }
    return slugify(unit.group) === subId;
  });
}

// Make text easy to compare: lower case, curly apostrophes made straight.
function simplify(text) {
  return text.toLowerCase().replace(/[’‘`]/g, "'");
}

// Units whose name contains every word typed, current units before Legends.
function searchUnits(units, query) {
  const words = simplify(query).split(/\s+/).filter(Boolean);
  return units
    .filter((unit) => {
      const name = simplify(unit.name);
      return words.every((word) => name.includes(word));
    })
    .sort((a, b) => (a.legends ? 1 : 0) - (b.legends ? 1 : 0) || a.name.localeCompare(b.name));
}

// "5 or 10 models", "1 model", "3-6 models"
function describeSizes(sizes) {
  if (!sizes || sizes.length === 0) {
    return '';
  }
  const plural = sizes[sizes.length - 1] === 1 ? ' model' : ' models';
  if (sizes.length === 1) {
    return sizes[0] + plural;
  }
  if (sizes.length === 2) {
    return sizes[0] + ' or ' + sizes[1] + plural;
  }
  return sizes[0] + '-' + sizes[sizes.length - 1] + plural;
}
