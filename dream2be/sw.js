const CACHE_NAME = 'dream2be-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/present.html',
  '/manifest.json',
  '/present-manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/present-icon-192.png',
  '/icons/present-icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS.map(url =>
        cache.add(url).catch(() => {/* skip failed assets */})
      ))
    )
  );
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

  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
