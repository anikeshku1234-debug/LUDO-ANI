// Instant Network First Cache to stop blank screen hanging
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always fetch latest directly from network
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
