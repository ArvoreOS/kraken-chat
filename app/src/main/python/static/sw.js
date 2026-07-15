const CACHE = "kraken-v3";
const SHELL = [
  "/",
  "/static/style.css",
  "/static/app.js",
  "/static/socket.io.min.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return; // sempre rede, nunca cache (dados em tempo real)
  }
  // Rede primeiro, cache só como fallback pra quando estiver offline - o
  // Kraken muda com frequência (o servidor é sempre localhost, custo de
  // rede é zero), então cache-primeiro deixava gente presa em telas
  // antigas até bumpar o nome do CACHE manualmente a cada deploy.
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
