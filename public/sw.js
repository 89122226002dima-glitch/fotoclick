// sw.js - Service Worker

const CACHE_NAME = 'fotoclick-cache-v1';
// Список файлов, которые нужно закэшировать для работы офлайн
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/prompts.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Установка Сервис-воркера и кэширование статических ресурсов
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// Активация Сервис-воркера и очистка старых кэшей
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Обработка запросов: отдаем из кэша, если есть, иначе идем в сеть
self.addEventListener('fetch', (event) => {
  // Мы не кэшируем API запросы
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Если ресурс есть в кэше, отдаем его
        if (response) {
          return response;
        }

        // Иначе, делаем запрос в сеть, кэшируем и отдаем
        return fetch(event.request).then(
          (response) => {
            // Проверяем, что ответ корректный
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});
