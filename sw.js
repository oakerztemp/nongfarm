// NongFarm service worker: app-shell cache so the game opens offline, and notification clicks.
// VERSION is stamped by .github/scripts/version_assets.py on deploy; every deploy gets its own cache.
const VERSION = 'dev';
const CACHE = `nongfarm-${VERSION}`;

// A new version waits until the next load to take over, never in the middle of play.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nongfarm-') && k !== CACHE).map(k => caches.delete(k)))),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch Firebase / Google / CDN traffic: only our own origin is cached.
  if (url.origin !== self.location.origin) return;
  const versioned = url.searchParams.has('v');
  if (request.mode === 'navigate' || !versioned) {
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? self.registration.scope : null));
  } else {
    event.respondWith(cacheFirst(request)); // ?v=<commit> URLs never change
  }
});

// Clicking a notification focuses the game (or opens it) on the right tab.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tab = (event.notification.data && event.notification.data.tab) || '';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        client.postMessage({ type: 'open-tab', tab });
        return;
      }
    }
    await self.clients.openWindow(`${self.registration.scope}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
  })());
});
