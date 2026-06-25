const CACHE = 'csa-plateau-v15-network-first';
const ASSETS = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Ne jamais intercepter Supabase (synchronisation temps réel)
  if (req.url.includes('supabase.co')) return;

  const isDoc = req.mode === 'navigate'
    || req.destination === 'document'
    || req.url.endsWith('/')
    || req.url.endsWith('index.html');

  if (isDoc) {
    // RÉSEAU D'ABORD pour l'app : toujours la dernière version, repli cache hors-ligne.
    e.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', clone));
        }
        return resp;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // CACHE D'ABORD pour les bibliothèques externes (stables, versionnées par URL).
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (!resp || resp.status !== 200) return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(cache => cache.put(req, clone));
        return resp;
      });
    })
  );
});
