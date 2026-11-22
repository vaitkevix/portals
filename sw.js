// SH | Portāls — service worker: instalēšana + push paziņojumi (Web Push). Dati vienmēr no tīkla. © VAITKEVIX, SIA
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (err) { m = { title: 'SH | Portāls', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'SH | Portāls', { body: m.body || '', icon: 'icon-192.png?v=4', badge: 'favicon-32.png?v=4', tag: m.tag || undefined, data: { url: m.url || '/sh/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/sh/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all.find(x => new URL(x.url).pathname.startsWith('/sh'));
    if (c) { await c.focus(); return c.navigate ? c.navigate(url).catch(() => 0) : 0; }
    return self.clients.openWindow(url);
  })());
});
