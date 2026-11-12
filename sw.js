// Offline support. Network first (so a new version or new data shows up right away when online),
// falling back to the saved copy when offline or when the network is too slow. Fonts: cache first.
const CACHE = 'huji-rooms-v4';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'combo.js', 'style.css', 'buildings.json', 'data.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-64.png'];
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
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(networkFirst(req, e));
});

async function networkFirst(req, e) {
  const cache = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? './' : req; // any page load → the app shell
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
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
