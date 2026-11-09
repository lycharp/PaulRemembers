// Minimal offline support: cache the app shell, network-first for everything else.
const CACHE = 'journal-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // Pages (index.html) always ask GitHub whether there is a newer copy, so a
  // refresh shows a new version right away instead of a stale cached one.
  const req = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
