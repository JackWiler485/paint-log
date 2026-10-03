# Paint Log

A miniature painting tracker that runs as a web app on the iPhone. It is installed from Safari to the home screen and works offline, with all data stored on the phone.

**Unofficial fan-made tool. Not affiliated with or endorsed by Games Workshop.**

---

## Features

- **Armies and miniatures**: create, edit and delete armies and the miniatures in them. Each army has a faction picked from a list, including the Space Marine chapters with their own units (Ultramarines, Imperial Fists, Iron Hands, Raven Guard, Salamanders, White Scars).
- **Unit search**: when adding a miniature, search the army's units by name. Picking a unit fills in its name and squad size. Legends units are marked. Any other name can be typed by hand.
- **Squads**: an entry can hold several models. The app tracks how many models are at each stage, and a squad counts as finished only when every model is.
- **Painting stages**: move each model through *On sprue → Assembled → Primed → Painted → Based*, one at a time or the whole squad at once, with a progress summary per army.
- **Backup and restore**: save all data to a single file (for example in the Files app) and restore it later.
- **Diagnostics**: a Settings screen showing whether the app runs from the home screen, whether storage is protected, how much space is used, and the app version.
- **Camera test**: checks the live rear camera and the photo picker.

Planned: colour schemes with a paint list, a shopping list of missing paints, progress photos, 360° turntable "spins" and simple army lists.

---

## Installing on the iPhone

1. Open the app's web address in **Safari** (other browsers on iPhone cannot install web apps).
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.
3. From then on, **always open the app from the home screen icon**.

## Data and backups

- All data stays on the phone. There is no account and no cloud sync.
- Safari and the home screen app keep **separate** data. Data entered in a Safari tab is not visible in the home screen app, and Safari may delete it after 7 days without use. Data in the home screen app is exempt from that clean-up.
- iOS can still clear app data if the phone runs very low on storage. Save a backup regularly: **Settings (⚙) → Create backup file → Save backup file… → Save to Files**. Settings shows the date of the last backup and a reminder when it is more than 14 days old.
- **Restore from backup…** replaces all data in the app with the contents of the backup. The whole file is checked first; if it is damaged or not a Paint Log backup, nothing is changed.

---

## Hosting a copy on GitHub Pages

Only a web browser is needed; no command line or build step.

1. Sign in at <https://github.com> (or create an account).
2. Click **+** at the top right, then **New repository**.
   - Name it, for example, `paint-log`. The name becomes part of the web address.
   - Choose **Public**. GitHub Pages is free for public repositories, and the code contains no personal data.
   - Click **Create repository**.
3. On the empty repository page, click **uploading an existing file** and drag in the app files:
   - `index.html`, `styles.css`, `app.js`, `db.js`, `units.js`, `sw.js`, `manifest.webmanifest`, `README.md`
   - the `icons` folder (3 PNG files)
   - the `vendor` folder (2 JavaScript files)
   - the `data` folder (`units.json` and its licence notice)

   Drag the folders themselves so they keep their names (Chrome and Edge handle folder dragging best). Only these files are part of the app.
4. Click **Commit changes** ("commit" means "save this version").
5. Check the file list: `icons` and `vendor` should appear as folders, not as loose files.
6. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
7. After a minute or two, the Pages screen shows the address, for example
   `https://YOUR-USERNAME.github.io/paint-log/`

### Updating a hosted copy

1. In the repository, click **Add file → Upload files**, drag in the changed files and click **Commit changes**. Files with the same name are replaced.
2. Every update must include a new version of `sw.js`, with a higher `CACHE_VERSION` number. Without it, installed copies of the app keep using the old files.
3. Wait a minute or two for GitHub Pages to publish the change.
4. On the iPhone, fully close the app (swipe it away in the app switcher) and open it again. It can take two reopenings before the new version appears.
5. Check **Settings (⚙) → Diagnostics → App version** shows the new version.

---

## Testing checklist (on the iPhone)

Open the app **from the home screen icon**, then check:

**Setup and diagnostics**
- [ ] **Settings → Diagnostics → Opened from home screen icon** says **yes**.
- [ ] **Storage protected (persist)** shows yes or no.
- [ ] **Storage used** shows a size.
- [ ] **Works offline** says **yes** (if it says "not yet", close and reopen the app).
- [ ] **App version** shows the expected version.
- [ ] **Offline**: with Airplane Mode on, fully close the app and open it from the icon. It still loads.

**Armies and miniatures**
- [ ] Create an army with a name and pick a faction (e.g. Ultramarines).
- [ ] **+ Add miniature**: type part of a unit name (e.g. "inter") in **Find a unit**, tap a result, and save. The name and number of models are filled in.
- [ ] Add a miniature by typing a name that is not in the list.
- [ ] Open a single miniature, tap **Next stage** a few times, and tap a stage directly. The army screen shows the new stage badges.
- [ ] Open a squad and move single models with the **‹ ›** buttons. The army screen shows the squad's least-advanced stage and the model counts.
- [ ] Change a squad's number of models with **Edit**.
- [ ] Rename a miniature and an army.
- [ ] Delete a miniature (a confirmation appears first).
- [ ] Fully close and reopen the app. Everything is still there.
- [ ] Swiping from the left edge goes back a screen. (This depends on the iOS version; the "‹ Back" links at the top always work.)

**Backup and restore**
- [ ] **Create backup file → Save backup file… → Save to Files**. The file `paint-log-backup-….json` appears in the Files app.
- [ ] Add a test miniature, then **Restore from backup…** and pick the backup file. After "Restore complete", the test miniature is gone and everything else is back.
- [ ] **Restore from backup…** with any other file (e.g. a photo) shows a red message saying the data was not changed.

**Camera**
- [ ] **Camera test → Start camera**: after allowing access, the live rear camera view appears.
- [ ] **Take photo**: a still picture appears with its size in pixels.
- [ ] **Backup method**: taking or choosing a photo with the file button shows it on screen.

### Troubleshooting

- Errors are shown on screen in red, with the exact error text. Note that text when reporting a problem.
- iOS may ask for camera permission again each time the app is opened. This is normal for home screen web apps.
- If an update does not appear, close and reopen the app once more.

---

## Updating the unit list

`data/units.json` is built from the BSData dataset by a script (needs Python 3 and PyYAML):

```
python3 tools/build-units.py
```

After rebuilding, raise `CACHE_VERSION` in `sw.js` and upload `data/units.json` and `sw.js`.

---

## Built with

- Plain HTML, CSS and JavaScript, with no framework and no build step.
- [Dexie.js](https://dexie.org) and its export/import add-on (Apache License 2.0) for the on-device database and backups, bundled in `vendor/`.
- Unit names, squad sizes and points from [BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm) (MIT License). See `data/THIRD-PARTY-NOTICES.md`.
