// Service worker: saves the app's files on the phone so it works offline.
//
// IMPORTANT: change CACHE_VERSION every time you upload new versions of
// any file. That tells the phone to download the new files.
// The version also shows on the Settings screen (app.js reads it from here).
const CACHE_VERSION = 'v0.4.0';
const CACHE_NAME = 'paint-log-' + CACHE_VERSION;

// Every file the app needs. Paths are relative so GitHub Pages works.
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './units.js',
  './paints.js',
  './data/units.json',
  './data/paints.json',
  './vendor/dexie.min.js',
  './vendor/dexie-export-import.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install: download fresh copies of all the app files and save them.
// ('reload' skips the browser's short-term copy, so we never save old files.)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete saved files from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('paint-log-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Let the page ask which version is running.
self.addEventListener('message', (event) => {
  if (event.data === 'get-version') {
    event.source.postMessage({ version: CACHE_VERSION });
  }
});

// Fetch: answer from the saved copy first, fall back to the network.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle our own files, and only plain downloads (GET).
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Page loads: always serve the saved index.html when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
