const CACHE = "kraken-v4";
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
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname.startsWith("/files/")
  ) {
    // sempre rede, nunca cache. /files/ (áudio/imagem/arquivo) entrou aqui
    // em 2026-08-31: achado real - o player de áudio nunca saía do 0:00
    // mesmo com o arquivo certo e o servidor respondendo certo. Duas causas
    // reais nessa rota específica que não existem em /api/ ou /socket.io/:
    // (1) Cache.put() REJEITA (TypeError) resposta 206 Partial Content por
    // spec - e todo <audio>/<video> pede Range, então every load gerava uma
    // promise rejeitada sem ninguém pegar; (2) Service Worker interceptando
    // fetch de mídia com Range é uma categoria de bug conhecida em vários
    // WebViews (a resposta passa a vir "encanada" pelo SW em vez de direto
    // da rede, e o pipeline de mídia do navegador nem sempre lida bem com
    // isso, principalmente com seek). Tirar /files/ da mão do SW elimina as
    // duas de uma vez - a mídia nunca precisou de cache offline mesmo (o
    // servidor é sempre localhost, custo de rede zero).
    return;
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
