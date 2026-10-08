// LeCochonnet — Service Worker (v2)
// Stratégie network-first : on cherche d'abord la dernière version sur le web,
// et on retombe sur le cache uniquement si le réseau échoue (mode hors-ligne).

const CACHE_NAME = 'lecochonnet-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './config.js',
  './manifest.webmanifest',
  './icon.svg'
];

// Installation : on précharge les assets dans le cache et on s'active immédiatement
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : on supprime les anciens caches et on prend le contrôle de toutes les pages ouvertes
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch : stratégie network-first pour les assets de l'app
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pour Supabase : on ne touche à rien, ça passe directement par le réseau
  if (url.hostname.includes('supabase')) return;

  // Gestion des comptes : toujours en direct
  if (url.pathname.startsWith('/api/')) return;

  // Seules les requêtes GET sont mises en cache
  if (event.request.method !== 'GET') return;

  // Network-first : on tente d'abord le réseau, on met à jour le cache si succès
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Si la requête a réussi (status 2xx) et qu'elle vient de notre origine, on met en cache
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Réseau indisponible (mode hors-ligne) : on cherche dans le cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Pour une navigation (ouverture de page), on retourne au moins index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // Sinon on laisse échouer
          return new Response('Hors ligne et ressource non disponible', { status: 503 });
        });
      })
  );
});

// Permet à la page de demander une mise à jour forcée
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
