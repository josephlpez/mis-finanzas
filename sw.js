// Trabajo sin conexión: guarda los archivos de la app en el dispositivo.
// Nunca guarda en caché las llamadas a Google (datos ni permisos).
// Al publicar una versión nueva de la app, sube el número de VERSION.

const VERSION = 'finanzas-v7';
const ARCHIVOS = [
  './',
  './index.html',
  './oauth.html',
  './js/oauth.js',
  './js/ajustes-google.js',
  './css/app.css',
  './js/app.js',
  './js/modelo.js',
  './js/util.js',
  './js/importar.js',
  './js/cripto.js',
  './js/sync.js',
  './js/db.js',
  './js/xlsx.js',
  './manifest.webmanifest',
  './iconos/icono.svg',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Google y demás: directo a la red
  if (url.pathname.includes('/api/') || url.pathname.includes('/prueba/')) return; // los datos nunca se guardan en caché
  // Primero la red (para recibir versiones nuevas); si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && r.type === 'basic') {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
