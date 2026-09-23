// Self-destroying service worker to clear cache and allow real-time sockets
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Bilkul bhi fetch block na kare
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
