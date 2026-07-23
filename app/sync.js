import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { applyState, createCrdtDoc, stateFromDoc } from "../sync/crdt.js";
import { decryptUpdate, encryptUpdate } from "../sync/crypto.js";

export function createEncryptedSyncPersistence({ room, key, endpoint, token, refreshToken, seedState, onStatus = () => {}, onToken = () => {} } = {}) {
  if (!room || !key || !endpoint || !token) throw new TypeError("room, key, endpoint and token are required");
  const { doc, entities } = createCrdtDoc();
  const indexed = new IndexeddbPersistence(`things-web-sync-${room}`, doc);
  const listeners = new Set();
  const pendingKey = `things-web-sync-pending-${room}`;
  let socket = null;
  let stopped = false;
  let synced = false;
  let connecting = false;
  let accessToken = token;
  let currentRefreshToken = refreshToken;
  let refreshing = null;

  const persistence = {
    async load() {
      await indexed.whenSynced;
      synced = true;
      const meta = doc.getMap("things-sync-meta");
      if (seedState && !meta.get("local-seeded")) {
        doc.transact(() => {
          // Entity maps keep independent IDs/fields; remote records are merged by Yjs.
          applyState(entities, seedState, "migration");
          meta.set("local-seeded", true);
        }, "migration");
      }
      return stateFromDoc(entities);
    },
    async save(state) { doc.transact(() => applyState(entities, state, "store"), "store"); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect() { connect(); },
    disconnect() { stopped = true; socket?.close(); socket = null; indexed.destroy(); },
    status: () => socket?.readyState === globalThis.WebSocket?.OPEN ? "connected" : synced ? "offline" : "starting",
  };

  doc.on("update", (update, origin) => {
    if (origin === "remote" || origin === "transport" || !synced) return;
    encryptUpdate(update, key, room).then(envelope => { enqueue(envelope); flush(); }).catch(() => onStatus("error"));
  });

  async function connect() {
    if (stopped || connecting || socket?.readyState === globalThis.WebSocket?.OPEN) return;
    connecting = true;
    onStatus("connecting");
    const url = endpoint.replace(/^http/, "ws").replace(/\/$/, "") + `/room/${encodeURIComponent(room)}`;
    try { socket = new WebSocket(url); } catch { connecting = false; onStatus("offline"); return; }
    socket.onopen = () => {
      connecting = false;
      socket.send(JSON.stringify({ type: "hello", token: accessToken, room }));
      onStatus("connected");
      flush();
    };
    socket.onclose = async event => {
      connecting = false;
      if (!stopped && currentRefreshToken && [1008, 4001].includes(event.code)) await refresh();
      onStatus("offline");
      if (!stopped) setTimeout(connect, 2000);
    };
    socket.onerror = () => onStatus("offline");
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "ack") { writePending(readPending().slice(Number(message.count) || 0)); return; }
        if (message.type !== "update" || message.room !== room) return;
        decryptUpdate(message.envelope, key, room).then(update => {
          Y.applyUpdate(doc, update, "remote");
          for (const listener of listeners) listener(stateFromDoc(entities));
        }).catch(() => onStatus("error"));
      } catch { onStatus("error"); }
    };
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = fetch(`${endpoint.replace(/\/$/, "")}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: currentRefreshToken }) })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("refresh_failed")))
      .then(result => {
        accessToken = result.token;
        currentRefreshToken = result.refreshToken || currentRefreshToken;
        onToken({ token: accessToken, refreshToken: currentRefreshToken });
        return accessToken;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  function flush() {
    if (socket?.readyState !== globalThis.WebSocket?.OPEN) return;
    readPending().forEach(envelope => socket.send(JSON.stringify({ type: "update", room, envelope })));
  }
  function enqueue(envelope) { writePending([...readPending(), envelope]); }
  function readPending() { try { return JSON.parse(globalThis.localStorage?.getItem(pendingKey) || "[]"); } catch { return []; } }
  function writePending(value) { try { globalThis.localStorage?.setItem(pendingKey, JSON.stringify(value)); } catch {} }
  return persistence;
}
