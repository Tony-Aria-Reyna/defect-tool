// Resero Defects - offline support. The app shell and libraries are cached; data is cached by Firestore itself.
const VERSION = 'resero-defects-2.45.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'img/resero-navy.png', 'img/resero-white.png',
  'js/app.js', 'js/admin.js', 'js/faces.js', 'js/autofit.js', 'js/ticksheet.js', 'js/sheetsync.js', 'js/fm.js', 'js/pack.js', 'js/dnd.js', 'js/help.js', 'js/nav.js', 'js/install.js', 'js/typicals.js', 'js/ai.js', 'js/config.js', 'js/exports.js', 'js/photos.js', 'js/planview.js', 'js/state.js', 'js/store.js', 'js/util.js',
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
  // app files: always fetched fresh from the server (a changing query string gets past the browser cache and the hosting CDN, which
  // could otherwise hand back files from different versions for some minutes after an update); the saved copy is for working offline
  e.respondWith((async () => {
    try {
      const b = new URL(r.url); b.searchParams.set('_', Date.now().toString(36));
      const net = await fetch(b.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!net.ok) return net;
      const fresh = new Response(await net.blob(), { status: net.status, statusText: net.statusText, headers: net.headers }), copy = fresh.clone();
      caches.open(VERSION).then(c => c.put(r, copy)).catch(() => {});
      return fresh;
    } catch (err) {
      const c = await caches.open(VERSION);
      return (await c.match(r, { ignoreSearch: true })) || (await caches.match(r, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
    }
  })());
});
