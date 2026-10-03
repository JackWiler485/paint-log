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
