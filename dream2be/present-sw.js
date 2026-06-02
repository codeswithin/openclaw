const CACHE_NAME = 'dream2be-present-v2';
const ASSETS = [
  '/present.html',
  '/present-manifest.json',
  '/icons/present-icon-192.png',
  '/icons/present-icon-512.png',
  'https://cdn.socket.io/4.7.5/socket.io.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.protocol === 'wss:' || url.pathname.startsWith('/socket.io')) return;

  // Cache-first for known CDN assets (socket.io) — survives offline
  if (url.href === 'https://cdn.socket.io/4.7.5/socket.io.min.js') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
        const c = r.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, c));
        return r;
      }))
    );
    return;
  }

  // Network-first for site assets — updates content, falls back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const c = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, c));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
