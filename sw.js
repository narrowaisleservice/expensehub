/* Network-first service worker: always tries the network so new deployments show up immediately,
   and falls back to the cache when offline. Bump VERSION to force-clear old caches. */
const VERSION = 'eh-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // never cache Supabase / CDN calls
  e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(VERSION).then(ch => ch.put(r, c)); return res; }).catch(() => caches.match(r)));
});
