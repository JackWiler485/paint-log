// The app's database, stored on the phone using Dexie (a helper for IndexedDB).
//
// Each line below is a "table" (like a spreadsheet tab). The text after the
// colon lists the columns we want to search by. '++id' means "give every row
// a unique number automatically". Other fields can still be saved; they just
// can't be searched quickly.
//
// All tables from the plan are created now, even ones the app doesn't use
// yet, so the backup already includes everything.

const DB_NAME = 'paint-log';

function defineTables(database) {
  database.version(1).stores({
    armies: '++id, name, createdAt',
    miniatures: '++id, armyId, stage, createdAt',
    schemeSteps: '++id, miniatureId, paintId',
    paints: '++id, name, range, owned',
    photos: '++id, miniatureId, takenAt',
    spins: '++id, miniatureId, takenAt',
    lists: '++id, armyId',
    listEntries: '++id, listId',
  });

  // Version 2 (Phase 2): miniatures become squads with a model count and
  // a count of models per stage. Existing entries become squads of 1.
  database.version(2).stores({
    miniatures: '++id, armyId, stage, createdAt',
  }).upgrade((tx) => tx.table('miniatures').toCollection().modify(normaliseSquad));
}

const db = new Dexie(DB_NAME);
defineTables(db);

// The painting stages, in order.
const STAGES = [
  { key: 'sprue', label: 'On sprue' },
  { key: 'assembled', label: 'Assembled' },
  { key: 'primed', label: 'Primed' },
  { key: 'painted', label: 'Painted' },
  { key: 'based', label: 'Based' },
];

function stageIndex(key) {
  return STAGES.findIndex((stage) => stage.key === key);
}

function stageLabel(key) {
  const stage = STAGES[stageIndex(key)];
  return stage ? stage.label : key;
}

// ---------- Squads ----------
// Every miniature entry is a squad of one or more models.
// stageCounts says how many models are at each stage, e.g. { sprue: 2, primed: 3 }.

function stageCountsOf(mini) {
  if (mini.stageCounts) {
    return mini.stageCounts;
  }
  // Entries saved before squads existed (or from an old backup).
  return { [mini.stage || 'sprue']: mini.models || 1 };
}

function modelCountOf(mini) {
  return Object.values(stageCountsOf(mini)).reduce((sum, n) => sum + n, 0);
}

// The fields to save for a squad: the counts (without zeros), the total, and
// the overall stage, which is the stage of the least-advanced model.
function squadFields(counts) {
  const clean = {};
  for (const stage of STAGES) {
    if (counts[stage.key] > 0) {
      clean[stage.key] = counts[stage.key];
    }
  }
  const first = STAGES.find((stage) => clean[stage.key] > 0);
  return {
    stageCounts: clean,
    models: Object.values(clean).reduce((sum, n) => sum + n, 0),
    stage: first ? first.key : 'sprue',
  };
}

// Change the squad size. New models start on the sprue; when shrinking,
// models are removed from the least-advanced stages first.
function resizeCounts(counts, newTotal) {
  const result = { ...counts };
  let diff = newTotal - Object.values(result).reduce((sum, n) => sum + n, 0);
  if (diff > 0) {
    result.sprue = (result.sprue || 0) + diff;
  }
  for (const stage of STAGES) {
    if (diff >= 0) {
      break;
    }
    const remove = Math.min(result[stage.key] || 0, -diff);
    result[stage.key] = (result[stage.key] || 0) - remove;
    diff += remove;
  }
  return result;
}

// Give an old-style miniature the squad fields (used by the upgrade and after a restore).
function normaliseSquad(mini) {
  Object.assign(mini, squadFields(stageCountsOf(mini)));
}

// ---------- Deleting ----------
// Deleting a miniature also deletes everything attached to it.
// It all happens in one "transaction": either everything is deleted or nothing is.

async function deleteMiniatures(miniatureIds) {
  await db.transaction('rw', db.miniatures, db.schemeSteps, db.photos, db.spins, async () => {
    await db.schemeSteps.where('miniatureId').anyOf(miniatureIds).delete();
    await db.photos.where('miniatureId').anyOf(miniatureIds).delete();
    await db.spins.where('miniatureId').anyOf(miniatureIds).delete();
    await db.miniatures.bulkDelete(miniatureIds);
  });
}

// Deleting an army deletes its miniatures (and their attachments) and its army lists.
async function deleteArmy(armyId) {
  await db.transaction('rw', db.tables, async () => {
    const miniatureIds = await db.miniatures.where('armyId').equals(armyId).primaryKeys();
    await deleteMiniatures(miniatureIds);

    const listIds = await db.lists.where('armyId').equals(armyId).primaryKeys();
    await db.listEntries.where('listId').anyOf(listIds).delete();
    await db.lists.bulkDelete(listIds);

    await db.armies.delete(armyId);
  });
}

// ---------- Backup ----------

// Make a backup file (a Blob) holding every table, including photos.
async function exportBackup() {
  return db.export();
}

// Replace all data with the contents of a backup file.
// Step 1 test-reads the whole file into a temporary scratch database.
// Only if that works do we touch the real data, so a damaged file
// can never wipe what is already on the phone.
async function importBackup(file) {
  const info = await checkBackupFile(file);

  const scratch = new Dexie(DB_NAME + '-import-check');
  defineTables(scratch);
  try {
    await scratch.import(file, {
      acceptNameDiff: true,
      acceptVersionDiff: true,
      acceptMissingTables: true,
      clearTablesBeforeImport: true,
    });
    // A cut-off file can still "import" without an error, just with rows
    // missing. So compare what we read with the counts in the file's header.
    await checkRowCounts(scratch, info);
  } finally {
    await scratch.delete();
  }

  await db.import(file, {
    acceptVersionDiff: true,
    acceptMissingTables: true,
    clearTablesBeforeImport: true,
  });

  // A backup from an older version may hold old-style miniatures.
  await db.miniatures.toCollection().modify(normaliseSquad);
}

async function checkRowCounts(database, info) {
  for (const table of info.data.tables) {
    const actual = await database.table(table.name).count();
    if (actual !== table.rowCount) {
      throw new Error('The backup file is incomplete or damaged (' + table.name + ': expected ' +
        table.rowCount + ' items, found ' + actual + ').');
    }
  }
}

// Quick look at a file's header to check it is a Paint Log backup.
async function checkBackupFile(file) {
  let info;
  try {
    info = await DexieExportImport.peakImportFile(file);
  } catch (err) {
    throw new Error('This file is not a Paint Log backup.');
  }
  if (!info || info.formatName !== 'dexie' || !info.data || info.data.databaseName !== DB_NAME) {
    throw new Error('This file is not a Paint Log backup.');
  }
  return info;
}
