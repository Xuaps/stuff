import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { deriveRoomKey, exportRoomKey, generateRoomKey, importRoomKey, decodeBytes } from "../sync/crypto.js";

export async function registerPasskey(endpoint, username = "things-user") {
  const optionsResponse = await request(endpoint, "/auth/register/options", { username });
  const response = await startRegistration({ optionsJSON: prepareOptions(optionsResponse) });
  const result = await request(endpoint, "/auth/register/verify", { challenge: optionsResponse.challenge, response });
  const key = await keyFromExtensions(response, result.room);
  return { ...result, key, recoveryKey: key ? await exportRoomKey(key) : null, prf: Boolean(key) };
}

export async function signInWithPasskey(endpoint, room = "") {
  const optionsResponse = await request(endpoint, "/auth/login/options", room ? { room } : {});
  const response = await startAuthentication({ optionsJSON: prepareOptions(optionsResponse) });
  const result = await request(endpoint, "/auth/login/verify", { challenge: optionsResponse.challenge, response });
  const key = await keyFromExtensions(response, result.room);
  return { ...result, key, recoveryKey: key ? await exportRoomKey(key) : null, prf: Boolean(key) };
}

export async function recoveryKey(value) { return importRoomKey(value); }
export async function newRecoveryKey() { return generateRoomKey(); }

export async function saveDeviceRecoveryKey(room, value) {
  const db = await keyDb();
  await requestStore(db, "readwrite", store => store.put({ id: String(room), room: String(room), key: value }));
}
export async function loadDeviceRecoveryKey(room) {
  if (!room) return null;
  const db = await keyDb();
  return (await requestStore(db, "readonly", store => store.get(String(room))))?.key || null;
}

function prepareOptions(options) {
  const prepared = structuredClone(options);
  const evaluation = prepared.extensions?.prf?.eval;
  for (const name of ["first", "second"]) {
    if (typeof evaluation?.[name] === "string") evaluation[name] = decodeBytes(evaluation[name]);
  }
  return prepared;
}

async function keyFromExtensions(response, room) {
  const first = response?.clientExtensionResults?.prf?.results?.first;
  if (!first) return null;
  try { return await deriveRoomKey(typeof first === "string" ? decodeBytes(first) : first, room); } catch { return null; }
}
async function request(endpoint, path, body) {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Sync request failed (${response.status})`);
  return response.json();
}
function keyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("things-web-sync-key", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestStore(db, mode, action) {
  return new Promise((resolve, reject) => {
    const request = action(db.transaction("keys", mode).objectStore("keys"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
