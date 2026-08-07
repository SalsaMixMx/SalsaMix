const CACHE_NAME = 'salsamix-admin-v101';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/firebase.js',
  './assets/img/logo-header.png',
  './assets/img/logo-ticket.png',
  './assets/img/logo-full.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async url => {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`No se pudo almacenar ${url}`);
      await cache.put(url, response);
    }));
  })());
  // No usamos skipWaiting aquí: la aplicación avisará al usuario
  // y activará la versión nueva cuando pulse "Actualizar ahora".
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase, mapas, fuentes y otros servicios externos mantienen su propia caché.
  if (url.origin !== self.location.origin) return;

  // Navegación: primero red, caché como respaldo. Así index.html se actualiza rápido.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match('./index.html')) || new Response('Sin conexión', { status: 503 });
      }
    })());
    return;
  }

  // Archivos de la app: caché rápida y actualización en segundo plano.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const networkPromise = fetch(request, { cache: 'no-cache' }).then(async response => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(networkPromise);
      return cached;
    }
    return (await networkPromise) || new Response('Sin conexión', { status: 503 });
  })());
});
