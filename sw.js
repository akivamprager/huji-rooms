// Offline support. Network first (so a new version or new data shows up right away when online),
// falling back to the saved copy when offline or when the network is too slow.
const CACHE = 'huji-rooms-v17';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'combo.js', 'style.css', 'campuses.js', 'data/gr.json', 'data/scopus.json', 'buildings/gr.json', 'buildings/scopus.json', 'paths/gr.json', 'paths/scopus.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-64.png', 'fonts/heebo-hebrew.woff2', 'fonts/heebo-latin.woff2'];
const TIMEOUT = 4000; // weak campus Wi-Fi: after this, answer from the cache and update in the background

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Only the app's own page is the app shell; other pages (README, demo/…) load normally and are
  // never saved in its place.
  const scope = new URL(self.registration.scope);
  const isApp = url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`;
  if (req.mode === 'navigate' && !isApp) return;
  e.respondWith(networkFirst(req, e, isApp));
});

async function networkFirst(req, e, isApp) {
  const cache = await caches.open(CACHE);
  const key = isApp && req.mode === 'navigate' ? './' : req; // the app page, with or without #… / ?…
  const net = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const saved = await cache.match(key, { ignoreSearch: true });
  if (!saved) return net;
  // whichever comes first: the network (within TIMEOUT) or, failing that, the saved copy
  return Promise.race([
    net.catch(() => saved),
    new Promise((res) => setTimeout(() => res(saved), TIMEOUT)),
  ]);
}
