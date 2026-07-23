const CACHE_NAME = "things-web-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./app/main.js",
  "./app/parse.js",
  "./app/persistence.js",
  "./app/store.js",
  "./app/views.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Browser-loaded dependencies are part of the shell too.
  "https://cdn.jsdelivr.net/npm/dexie@4/+esm",
  "https://cdn.jsdelivr.net/npm/chrono-node@2/+esm",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith("things-web-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    if (response.ok || request.mode !== "navigate") return response;
  } catch {
    // Fall through to the cached app shell for offline navigations.
  }

  return caches.match("./index.html");
}
