const CACHE_NAME = 'fotoclick-cache-v3';
const urlsToCache = [
  '/',
  'index.html',
  'index.css',
  'bundle.js',
  'prompts.json',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

// Install: Open cache and add all core assets.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching assets for version:', CACHE_NAME);
        return cache.addAll(urlsToCache);
      })
  );
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();
});

// Activate: Clean up old caches and take control of the page.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Tell the active service worker to take control of the page immediately.
      console.log('New service worker claiming clients.');
      return self.clients.claim();
    })
  );
});

// Fetch: Implement "Stale-While-Revalidate" strategy.
self.addEventListener('fetch', event => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Ignore API calls which should not be cached.
  if (event.request.url.includes('/api/')) {
    // Let the network handle it.
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        // Stale-while-revalidate strategy:
        // 1. Always fetch from the network in the background to get the latest version.
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // If we got a valid response, clone it and update the cache.
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(error => {
          // Network request failed, probably offline.
          console.warn('Network request failed for:', event.request.url, error);
          // If the network fails, we've already returned the cached response (if available).
          // If not cached, the original fetch promise rejection will propagate.
        });

        // 2. Return the cached response immediately if it exists, otherwise wait for the network.
        // This makes the app load fast from cache while updating itself in the background.
        return cachedResponse || fetchPromise;
      });
    })
  );
});
