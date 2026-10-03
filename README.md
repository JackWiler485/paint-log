# Paint Log

A personal miniature painting tracker that runs as a web app on an iPhone.

**Unofficial fan-made tool. Not affiliated with or endorsed by Games Workshop.**

---

## Putting the app online (GitHub Pages, web interface only)

You only need a web browser on a computer. No command line.

### First time

1. Sign in at <https://github.com>. If you don't have an account, create one.
2. Click the **+** at the top right, then **New repository**.
   - Repository name: `paint-log` (any name works, but it becomes part of the web address).
   - Choose **Public**. GitHub Pages is free for public repositories, and the code holds no personal data.
   - Leave the other options alone. Click **Create repository**.
3. On the new, empty repository page, click the link **uploading an existing file**.
4. Upload these files and the folder:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.webmanifest`
   - `sw.js`
   - `README.md`
   - the whole `icons` folder (it holds 3 picture files)

   The easiest way is to open the project folder on your computer, select all of the above, and drag them into the browser window. Dragging a folder keeps its name, so `icons` stays a folder. Chrome and Edge handle folder dragging best.

   Do **not** upload the `.claude` folder. It is only for my local testing.
5. At the bottom, click **Commit changes**. ("Commit" means "save this version".)
6. Check the file list: you should see `icons` as a folder, not three loose `.png` files. If the PNGs landed loose, delete them and upload again, this time dragging the folder itself.
7. Click **Settings** (top of the repository page), then **Pages** in the left menu.
   - Under **Build and deployment**, set **Source** to **Deploy from a branch**.
   - Set **Branch** to `main` and the folder to `/ (root)`. Click **Save**.
8. Wait one or two minutes, then refresh that Pages screen. It shows your address, like
   `https://YOUR-USERNAME.github.io/paint-log/`

### Installing on the iPhone

1. Open the address in **Safari** (not Chrome) on the iPhone.
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.
3. From now on, **always open the app from the home screen icon**.
   - Safari and the home screen app keep separate data. Data in the home screen app is protected from Safari's 7-day clean-up; data in Safari is not.
   - Do not enter anything in the Safari version.

### Updating the app later

When I change files, I will give you the exact list of files to upload. That list will **always include `sw.js`**, because it holds the version number. If `sw.js` doesn't change, the phone doesn't know there is an update.

1. In the repository, click **Add file → Upload files**, drag in the changed files, and click **Commit changes**. Files with the same name are replaced.
2. Wait a minute or two for GitHub Pages to update.
3. On the iPhone, fully close the app (swipe it away in the app switcher) and open it again. Sometimes it takes two reopenings.
4. Check **Settings / Diagnostics → App version**. It should show the new version number.

---

## Phase 0 test checklist (on the iPhone)

Open the app **from the home screen icon**, then:

- [ ] **Settings / Diagnostics → Opened from home screen icon** says **yes**.
- [ ] **Storage protected (persist)**: note what it says (yes / no).
- [ ] **Storage used**: shows numbers in MB.
- [ ] **Works offline**: says **yes** (if it says "not yet", close the app and open it again).
- [ ] **App version** shows `v0.1.0`.
- [ ] **Camera test → Start camera**: allow camera access. The live view from the rear camera appears.
- [ ] **Take photo**: a still picture appears below, with its size in pixels.
- [ ] **Backup method**: tap the file button, take or choose a photo, and check that it appears.
- [ ] **Offline**: turn on Airplane Mode, fully close the app, open it from the icon. It should still load.

If something fails, write down the exact text shown on screen (especially any red error text) and send it to me.

Note: iOS may ask for camera permission again each time you open the app. That is normal for home screen web apps.
