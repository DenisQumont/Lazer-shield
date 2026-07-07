// sw.js
const CACHE_VERSION = 'v18'; 
const CACHE_NAME = `lazer-cache-${CACHE_VERSION}`;
const urlsToCache = [
    '/Lazer-shield/',
    '/Lazer-shield/index.html',
    '/Lazer-shield/script.js',
    '/Lazer-shield/manifest.json',
    '/Lazer-shield/icons/icon-192.png',
    '/Lazer-shield/icons/icon-512.png',
    '/Lazer-shield/icons/icon-192-maskable.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
            .catch(() => new Response('Offline', { status: 503 }))
    );
});