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
  "./app/auth.js",
  "./app/push.js",
  "./app/sync-ui.js",
  "./app/sync.js",
  "./sync/crdt.js",
  "./sync/crypto.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
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

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let message = {};
    try { message = event.data?.json() || {}; } catch { /* malformed push */ }
    const notification = await decryptNotification(message.payload);
    await self.registration.showNotification(notification.title, { body: notification.body, tag: "things-deadline", data: notification.data });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(existing => {
    const client = existing[0];
    return client ? client.focus() : clients.openWindow("./");
  }));
});

self.addEventListener("message", event => {
  if (event.data?.type !== "sync-key") return;
  event.waitUntil(saveSyncKey(event.data.room, event.data.key));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(cacheFirst(event.request));
});

async function decryptNotification(envelope) {
  const fallback = { title: "A Things deadline is due", body: "Open Things to review it." };
  if (!envelope?.version || !envelope.nonce || !envelope.ciphertext) return fallback;
  try {
    const record = await readSyncKey();
    if (!record) return fallback;
    const key = await crypto.subtle.importKey("raw", fromBase64(record.key), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.nonce), additionalData: new TextEncoder().encode(`things-sync:${record.room}:${envelope.version}`) }, key, fromBase64(envelope.ciphertext));
    return { ...fallback, ...JSON.parse(new TextDecoder().decode(plaintext)) };
  } catch { return fallback; }
}

function fromBase64(value) {
  const text = value.replaceAll("-", "+").replaceAll("_", "/") + "===";
  const decoded = atob(text.slice(0, text.length - text.length % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
function syncDb() { return new Promise((resolve, reject) => { const request = indexedDB.open("things-web-sync-key", 1); request.onupgradeneeded = () => request.result.createObjectStore("keys", { keyPath: "id" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function saveSyncKey(room, key) { const db = await syncDb(); const transaction = db.transaction("keys", "readwrite"); transaction.objectStore("keys").put({ id: "current", room, key }); }
async function readSyncKey() { const db = await syncDb(); return new Promise((resolve, reject) => { const request = db.transaction("keys").objectStore("keys").get("current"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

function isCdnRequest(request) {
  const url = new URL(request.url);
  return url.origin !== self.location.origin && /(^|\.)cdn\.jsdelivr\.net$/.test(url.hostname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && (new URL(request.url).origin === self.location.origin || isCdnRequest(request))) {
      const cache = await caches.open(CACHE_NAME);
      // Cross-origin dependencies are cached only after the browser requests them.
      await cache.put(request, response.clone());
    }
    if (response.ok || request.mode !== "navigate") return response;
  } catch {
    // Fall through to the cached app shell for offline navigations.
  }

  return caches.match("./index.html");
}
