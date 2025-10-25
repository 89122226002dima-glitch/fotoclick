// sw.js - Service Worker

const CACHE_NAME = 'fotoclick-cache-v4'; // Версия обновлена для принудительной переустановки
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
  self.skipWaiting(); // Принудительная активация нового сервис-воркера
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
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Захватываем контроль над открытыми страницами
  );
});

// Обработка запросов: стратегия "сначала сеть, потом кэш" (Network First)
self.addEventListener('fetch', (event) => {
  // Мы не кэшируем API запросы и запросы, не являющиеся http/https
  if (!event.request.url.startsWith('http') || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Успешный запрос к сети. Кэшируем свежий ответ.
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      })
      .catch(() => {
        // Запрос к сети не удался (например, нет интернета).
        // Пытаемся отдать ответ из кэша.
        return caches.match(event.request);
      })
  );
});
