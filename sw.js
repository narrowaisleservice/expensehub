/* Flexi Expenses service worker: lets the app open with no signal.
   - App files: network first (new deployments show up straight away), but fall back to the saved copy after 4s or when offline.
   - Libraries and fonts from CDNs: saved the first time they load, then served from the saved copy.
   - Supabase, exchange-rate and map calls are never saved. Bump VERSION to clear old caches. */
const VERSION = 'eh-v13';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'core.js', 'offline.js', 'expenses.js', 'reports.js', 'finance.js', 'admin.js', 'pack.js','camera.js','journey.js', 'extras.js', 'app.js',
  'manifest.webmanifest', 'flexi-logo-white.svg', 'flexi-logo-red.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'tessdata.projectnaptha.com', 'unpkg.com'];

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await Promise.all(SHELL.map(u => c.add(u).catch(() => { })));
  await Promise.all(CDN.map(u => fetch(new Request(u, { mode: 'no-cors' })).then(r => c.put(u, r)).catch(() => { })));
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(r => { clearTimeout(t); res(r); }, e => { clearTimeout(t); rej(e); }); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  const same = u.origin === location.origin;
  if (!same && !CACHEABLE_HOSTS.includes(u.hostname)) return;                     // Supabase, FX rates, maps: never cached
  if (same) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const res = await withTimeout(fetch(r), 4000);
        if (res.ok) c.put(r, res.clone());
        return res;
      } catch (err) {
        return (await c.match(r, { ignoreSearch: true })) || (r.mode === 'navigate' ? await c.match('index.html') || await c.match('./') : undefined) || Response.error();
      }
    })());
  } else {
    e.respondWith((async () => {                                                  // CDN: saved copy first, refresh in the background
      const c = await caches.open(VERSION), hit = await c.match(r);
      const net = fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; }).catch(() => undefined);
      return hit || (await net) || Response.error();
    })());
  }
});
