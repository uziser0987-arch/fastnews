// Service worker de Fast News: instalación PWA + notificaciones push
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // requerido para que sea instalable

// Mostrar notificaciones del sistema
self.addEventListener("message", e => {
  if (e.data && e.data.tipo === "noti") {
    self.registration.showNotification("Fast News", {
      body: e.data.texto,
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: e.data.tag || "fast-news"
    });
  }
});

// Al tocar la notificación, abre la app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/"));
});
