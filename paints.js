// Paints: the Warhammer paint list from data/paints.json, copied into the
// database so "owned" ticks and colour corrections are saved and backed up.
// (data/paints.json is built by tools/build-paints.py; see data/THIRD-PARTY-NOTICES.md.)

// Ranges in the order they are listed in filters.
const RANGE_ORDER = ['Base', 'Layer', 'Shade', 'Contrast', 'Dry', 'Technical', 'Glaze',
  'Spray', 'Tone Pro', 'Air', 'Foundation', 'Foundation Wash', 'Foundation Primer'];

// What a paint does, as stored in the list, with a label for the screen.
const PAINT_TYPES = [
  { key: 'opaque', label: 'Paint' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'wash', label: 'Shade / wash' },
  { key: 'glaze', label: 'Glaze' },
  { key: 'ink', label: 'Ink' },
  { key: 'technical', label: 'Technical' },
  { key: 'primer', label: 'Primer' },
  { key: 'varnish', label: 'Varnish' },
  { key: 'medium', label: 'Medium' },
];

const TECHNIQUES = ['Primer', 'Base', 'Layer', 'Shade', 'Contrast', 'Drybrush',
  'Edge highlight', 'Glaze', 'Technical', 'Other'];

// The technique a paint is usually used for, to pre-fill the step form.
function suggestedTechnique(paint) {
  const byRange = {
    Base: 'Base', Layer: 'Layer', Shade: 'Shade', Contrast: 'Contrast', Dry: 'Drybrush',
    Technical: 'Technical', Glaze: 'Glaze', Spray: 'Primer', 'Tone Pro': 'Layer', Air: 'Base',
  };
  const byType = { wash: 'Shade', contrast: 'Contrast', glaze: 'Glaze', primer: 'Primer', technical: 'Technical' };
  return byRange[paint.range] || byType[paint.type] || 'Base';
}

function paintTypeLabel(key) {
  const type = PAINT_TYPES.find((t) => t.key === key);
  return type ? type.label : key || '';
}

// ---------- Loading and keeping the database up to date ----------

let paintCataloguePromise = null;

function loadPaintCatalogue() {
  if (!paintCataloguePromise) {
    paintCataloguePromise = fetch('data/paints.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load the paint list (' + response.status + ').');
        }
        return response.json();
      })
      .catch((err) => {
        paintCataloguePromise = null;
        throw err;
      });
  }
  return paintCataloguePromise;
}

// Add paints that are new in the list and update changed details.
// A colour the owner corrected (hex different from the list's colour) is kept.
async function syncPaints() {
  const catalogue = await loadPaintCatalogue();
  const rows = await db.paints.toArray();
  const byCatalogueId = new Map(rows.filter((p) => p.catalogueId).map((p) => [p.catalogueId, p]));
  const adds = [];
  const updates = [];

  for (const paint of catalogue.paints) {
    const fields = {
      name: paint.name,
      range: paint.range,
      type: paint.type,
      catalogueHex: paint.hex,
      discontinued: Boolean(paint.discontinued),
      metallic: Boolean(paint.metallic),
    };
    const row = byCatalogueId.get(paint.id);
    if (!row) {
      adds.push({ catalogueId: paint.id, ...fields, hex: paint.hex, owned: false });
      continue;
    }
    const corrected = row.catalogueHex && row.hex !== row.catalogueHex;
    const changes = { ...fields, hex: corrected ? row.hex : paint.hex };
    if (Object.keys(changes).some((key) => row[key] !== changes[key])) {
      updates.push({ key: row.id, changes });
    }
  }

  if (adds.length || updates.length) {
    await db.transaction('rw', db.paints, async () => {
      await db.paints.bulkAdd(adds);
      await db.paints.bulkUpdate(updates);
    });
  }
  return { added: adds.length, updated: updates.length };
}

// ---------- Searching ----------

// Range names: the list's order first, then any typed for custom paints.
function rangeNames(paints) {
  const extra = [...new Set(paints.map((p) => p.range).filter((r) => r && !RANGE_ORDER.includes(r)))].sort();
  return RANGE_ORDER.concat(extra);
}

// Paints matching every word typed (in the name or range), owned first.
// Options: range (only that range), ownedOnly, showDiscontinued, hideAir.
// Owned paints are always shown, even if discontinued or Air.
function filterPaints(paints, query, options = {}) {
  const words = simplify(query || '').split(/\s+/).filter(Boolean);
  return paints
    .filter((paint) => {
      if (options.range && paint.range !== options.range) {
        return false;
      }
      if (options.ownedOnly && !paint.owned) {
        return false;
      }
      if (!paint.owned && !options.range) {
        if (paint.discontinued && !options.showDiscontinued) {
          return false;
        }
        if (paint.range === 'Air' && options.hideAir) {
          return false;
        }
      }
      const text = simplify(paint.name + ' ' + (paint.range || ''));
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0) ||
      a.name.localeCompare(b.name) ||
      rangeIndex(a.range) - rangeIndex(b.range));
}

function rangeIndex(range) {
  const i = RANGE_ORDER.indexOf(range);
  return i === -1 ? RANGE_ORDER.length : i;
}

// ---------- Showing paints ----------

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// A round colour sample. Metallic paints get a shine.
function paintSwatch(paint, className) {
  const swatch = document.createElement('span');
  swatch.className = 'swatch' + (className ? ' ' + className : '');
  if (paint && HEX_PATTERN.test(paint.hex)) {
    swatch.style.backgroundColor = paint.hex;
  } else {
    swatch.classList.add('swatch-empty');
  }
  if (paint && paint.metallic) {
    swatch.classList.add('metallic');
  }
  return swatch;
}

// "Macragge Blue · Base"
function paintLabel(paint) {
  return paint.range ? paint.name + ' · ' + paint.range : paint.name;
}
