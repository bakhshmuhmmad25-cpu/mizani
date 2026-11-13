const V = 'mizani-2.1.0-1794564640';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(V).then((c) => c.addAll(["./", "app.css", "app.js", "boot.js", "config.js", "core.js", "fonts", "fonts/OFL-LICENSE.txt", "fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", "fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2", "fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", "fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", "fonts/ibm-plex-sans-arabic-latin-400-normal.woff2", "fonts/ibm-plex-sans-arabic-latin-500-normal.woff2", "fonts/ibm-plex-sans-arabic-latin-600-normal.woff2", "fonts/ibm-plex-sans-arabic-latin-700-normal.woff2", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon.png", "index.html", "manifest.webmanifest", "mobile.css", "shim.js", "sql-wasm.js", "sql-wasm.wasm", "sync.js", "ui.js"]))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Google/Drive calls go straight to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
