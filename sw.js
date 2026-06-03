const CACHE_NAME = "iol-cartera-pro-v12";
const PRECACHE = [
  "./app-integrada.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

const API_PATHS = ["/.netlify/functions/", "/api/"];

function isApiCall(url) {
  return API_PATHS.some(p => url.includes(p));
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
    .then(() => self.clients.claim())
    .then(() => {
      return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }));
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (isApiCall(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./app-integrada.html"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
