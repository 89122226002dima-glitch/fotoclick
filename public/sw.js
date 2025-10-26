// sw.js - Service Worker

const CACHE_NAME = 'fotoclick-cache-v4'; // <--- ВЕРСИЯ ИЗМЕНЕНА!
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

// Обработка запросов: стратегия "Сначала сеть, потом кэш" (Network-First)
self.addEventListener('fetch', (event) => {
  // Мы не кэшируем API запросы
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    // 1. Пытаемся получить ресурс из сети
    fetch(event.request)
      .then((networkResponse) => {
        // 2. Если успешно, кэшируем свежую версию и отдаем ее
        return caches.open(CACHE_NAME).then((cache) => {
          // Важно клонировать ответ, так как его можно использовать только один раз
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // 3. Если сеть недоступна, пытаемся отдать ресурс из кэша
        return caches.match(event.request);
      })
  );
});
