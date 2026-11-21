// SH | Portāls — vienkāršs service worker (lai var instalēt). Dati vienmēr no tīkla. © VAITKEVIX, SIA
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
