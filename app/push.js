import { decodeBytes, encodeBytes, encryptUpdate, exportRoomKey } from "../sync/crypto.js";

export function authorizedFetch(endpoint, auth = {}) {
  const state = typeof auth === "string" ? { token: auth } : auth;
  let refreshing = null;
  const base = endpoint.replace(/\/$/, "");
  return async (path, init = {}) => {
    const send = () => fetch(`${base}${path}`, withAuthorization(init, state.token));
    let response = await send();
    if (response.status !== 401 || !state.refreshToken) return response;
    if (!refreshing) {
      refreshing = fetch(`${base}/auth/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      }).then(result => result.ok ? result.json() : Promise.reject(new Error("refresh_failed")))
        .then(result => {
          state.token = result.token;
          state.refreshToken = result.refreshToken || state.refreshToken;
          state.onToken?.({ token: state.token, refreshToken: state.refreshToken });
          return result.token;
        })
        .finally(() => { refreshing = null; });
    }
    try { await refreshing; } catch { return response; }
    return send();
  };
}

export function createPushClient(endpoint, auth) {
  const request = authorizedFetch(endpoint, auth);
  return {
    subscribe: vapidPublicKey => subscribe(request, vapidPublicKey),
    schedule: (taskId, room, key, sendAt, notification) => schedule(request, taskId, room, key, sendAt, notification),
    cancel: jobId => cancel(request, jobId),
    list: () => list(request),
    jobKey: (taskId, key) => deriveJobKey(key, taskId),
  };
}

export async function subscribePush(endpoint, token, vapidPublicKey, refreshToken) {
  return subscribe(authorizedFetch(endpoint, authState(token, refreshToken)), vapidPublicKey);
}
export async function scheduleDeadline(endpoint, token, taskId, room, key, sendAt, notification, refreshToken) {
  return schedule(authorizedFetch(endpoint, authState(token, refreshToken)), taskId, room, key, sendAt, notification);
}
export async function cancelDeadline(endpoint, token, jobId, refreshToken) {
  return cancel(authorizedFetch(endpoint, authState(token, refreshToken)), jobId);
}

async function subscribe(request, vapidPublicKey) {
  if (!vapidPublicKey) throw new Error("The sync server has not configured VAPID reminders");
  if (!navigator.serviceWorker || !("PushManager" in globalThis)) throw new Error("Push is not supported");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(vapidPublicKey) });
  const response = await request("/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription }) });
  if (!response.ok) throw new Error("Push subscription failed");
  return subscription;
}
async function schedule(request, taskId, room, key, sendAt, notification) {
  const payload = await encryptUpdate(new TextEncoder().encode(JSON.stringify(notification)), key, room);
  const jobKey = await deriveJobKey(key, taskId);
  const response = await request("/push/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, jobKey, sendAt, payload }) });
  if (!response.ok) throw new Error("Deadline scheduling failed");
  return (await response.json()).id;
}
async function cancel(request, jobId) {
  const response = await request(`/push/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Deadline cancellation failed");
}
async function list(request) {
  const response = await request("/push/jobs", { method: "GET" });
  if (!response.ok) throw new Error("Deadline listing failed");
  return (await response.json()).jobs || [];
}
async function deriveJobKey(key, taskId) {
  let material;
  if (typeof key === "string") material = decodeBytes(key);
  else {
    try { material = new Uint8Array(await crypto.subtle.exportKey("raw", key)); }
    catch {
      // Non-exportable imported keys still provide deterministic identity through AES.
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, new TextEncoder().encode(String(taskId)));
      return encodeRoomBytes(encrypted);
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array([...material, ...new TextEncoder().encode(`\0${taskId}`)]));
  return encodeRoomBytes(digest);
}
function encodeRoomBytes(value) { return encodeBytes(new Uint8Array(value)); }
function authState(token, refreshToken) { return typeof token === "string" ? { token, refreshToken } : token || {}; }
function withAuthorization(init, token) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}
function decode(value) {
  return decodeBytes(value);
}
