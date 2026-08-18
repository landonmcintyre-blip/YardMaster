const CACHE_NAME = "yardmaster-shell-auto";
const APP_SCOPE = self.registration.scope;

const INDEX_URL = new URL("index.html", APP_SCOPE).href;
const ZXING_URL =
  "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";

const APP_FILES = [
  APP_SCOPE,
  INDEX_URL,
  new URL("style.css?v=2", APP_SCOPE).href,
  new URL("app.js?v=2", APP_SCOPE).href,
  ZXING_URL
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(APP_SCOPE);

  const isYardMasterFile =
    requestUrl.origin === scopeUrl.origin &&
    requestUrl.pathname.startsWith(scopeUrl.pathname);

  const isZxingFile = request.url === ZXING_URL;

  if (!isYardMasterFile && !isZxingFile) return;

  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then(response => {
        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, copy);
        });

        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;

          if (request.mode === "navigate") {
            return caches.match(INDEX_URL);
          }

          throw new Error("File unavailable offline.");
        })
      )
  );
});