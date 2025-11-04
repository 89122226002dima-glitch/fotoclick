// sw.js - Service Worker Uninstaller

self.addEventListener('install', () => {
  // This service worker is designed to unregister itself and clean up.
  // It ensures that no service worker is active by immediately skipping the waiting phase.
  console.log('[SW-Uninstaller] Installing to take over and unregister...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW-Uninstaller] Activating to finalize unregistration...');
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => {
        console.log('[SW-Uninstaller] Unregistration successful.');
        // After unregistering, find all clients (open tabs) and refresh them
        // to ensure they are no longer controlled by any service worker.
        return self.clients.matchAll({ type: 'window' });
      })
      .then((clients) => {
        clients.forEach((client) => {
          if (client.url && 'navigate' in client) {
            console.log(`[SW-Uninstaller] Refreshing client: ${client.url}`);
            client.navigate(client.url);
          }
        });
      })
  );
});

// This service worker should not handle any fetch events.
// It exists only to remove itself.
self.addEventListener('fetch', () => {
  // Intentionally do nothing.
});
