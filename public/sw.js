// sw.js - Simplified Service Worker Uninstaller

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
        console.log('[SW-Uninstaller] Unregistration successful. The browser will use the new version on the next load.');
        // No longer forcing a refresh on all clients to avoid race conditions.
        // The page's own cache-busting will handle loading the new version.
      })
  );
});

// This service worker should not handle any fetch events.
// It exists only to remove itself.
self.addEventListener('fetch', () => {
  // Intentionally do nothing.
});
