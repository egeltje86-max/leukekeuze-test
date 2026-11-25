// Eenvoudige offline-cache: eigen bestanden eerst van internet (zodat updates aankomen), anders uit de cache.
const CACHE = 'vondst-v3';
const BESTANDEN = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BESTANDEN)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.openai.com') return;
  if (url.hostname.includes('arcgisonline') || url.hostname.includes('openstreetmap')) {
    // kaarttegels: cache waar mogelijk, zodat eerder bekeken velden offline te zien zijn
    e.respondWith(caches.open('vondst-tegels').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; } catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    const kopie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)).catch(() => {}); return r;
  }).catch(() => caches.match(e.request)));
});
