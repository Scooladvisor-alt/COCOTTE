// Service worker de Cocotte, généré à chaque construction (vite.config.ts) : VERSION et PRECACHE sont
// remplacés par l'empreinte de la version et la liste de ses fichiers.
//
// - Le jeu entier (code, styles, polices, icônes) est gardé en cache à la première visite : on peut
//   ensuite jouer sans connexion. La partie, elle, est enregistrée dans le navigateur (localStorage).
// - La page est toujours demandée au réseau d'abord : une nouvelle version déployée arrive dès qu'on a
//   du réseau, et le cache ne sert que hors connexion (ou si le réseau est trop lent).
// - Rien ne sort du site : les appels au serveur en ligne (classement, visites) ne passent jamais par le cache.
// - À chaque nouvelle version, les caches des anciennes sont supprimés.
const VERSION = '__VERSION__';
const CACHE = `cocotte-${VERSION}`;
const PRECACHE = __PRECACHE__;
const PAGE = 'index.html';
/** Au-delà, on sert la page du cache plutôt que de faire attendre le joueur. */
const NETWORK_TIMEOUT = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('cocotte-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // serveur en ligne, polices ou services d'ailleurs : le navigateur s'en charge, sans cache
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // les pages à part (mentions légales, conditions, confidentialité) : le navigateur s'en charge
    if (url.pathname.endsWith('.html') && url.pathname !== '/index.html') return;
    event.respondWith(page(req));
    return;
  }
  event.respondWith(file(req));
});

/** La page : le réseau d'abord (nouvelle version), le cache si l'on est hors ligne ou si le réseau traîne. */
async function page(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') void cache.put(PAGE, res.clone());
    return res;
  });
  const cached = cache.match(PAGE);
  try {
    return await Promise.race([
      network,
      new Promise((resolve, reject) =>
        setTimeout(() => cached.then((r) => (r ? resolve(r) : reject(new Error('lent')))), NETWORK_TIMEOUT),
      ),
    ]);
  } catch {
    const r = (await cached) ?? (await caches.match(PAGE));
    if (r) return r;
    return network;
  }
}

/** Code, styles, polices, images : leurs noms changent avec leur contenu, le cache suffit. */
async function file(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') void cache.put(req, res.clone());
  return res;
}
