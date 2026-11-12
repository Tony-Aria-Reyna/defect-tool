// Resero Defects - offline support. The app shell and libraries are cached; data is cached by Firestore itself.
const VERSION = 'resero-defects-2.39.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'img/resero-navy.png', 'img/resero-white.png',
  'js/app.js', 'js/admin.js', 'js/faces.js', 'js/autofit.js', 'js/fm.js', 'js/pack.js', 'js/dnd.js', 'js/help.js', 'js/nav.js', 'js/install.js', 'js/typicals.js', 'js/ai.js', 'js/config.js', 'js/exports.js', 'js/photos.js', 'js/planview.js', 'js/state.js', 'js/store.js', 'js/util.js',
  'lib/firebase/firebase-app.js', 'lib/firebase/firebase-auth.js', 'lib/firebase/firebase-firestore.js', 'lib/firebase/firebase-storage.js',
  'lib/pdf-lib.min.js', 'lib/jszip.min.js', 'lib/xlsx.bundle.js', 'lib/pdfjs/pdf.min.mjs', 'lib/pdfjs/pdf.worker.min.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('resero-defects') && x !== VERSION && x !== 'resero-defects-img').map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url);
  // plan images and photos from Firebase Storage: cache first, so plans work with no signal once viewed
  if (/firebasestorage\.googleapis\.com$/.test(u.hostname)) { e.respondWith(caches.open('resero-defects-img').then(c => c.match(r).then(m => m || fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; })))); return; }
  if (u.origin !== location.origin) return;
  // app files: network first so updates arrive, cache when offline
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then(x => x.put(r, c)); } return res; }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
