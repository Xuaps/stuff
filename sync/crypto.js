const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function base64(value) {
  const input = bytes(value);
  if (typeof Buffer !== "undefined") return Buffer.from(input).toString("base64url");
  let text = "";
  input.forEach(byte => { text += String.fromCharCode(byte); });
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(value) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64url"));
  const text = value.replaceAll("-", "+").replaceAll("_", "/") + "===";
  const decoded = atob(text.slice(0, text.length - text.length % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export function associatedData(room, version = 1) {
  return textEncoder.encode(`things-sync:${String(room)}:${version}`);
}

export async function importRoomKey(value) {
  const raw = typeof value === "string" ? fromBase64(value) : bytes(value);
  if (raw.byteLength !== 32) throw new TypeError("A recovery key must contain 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function generateRoomKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { key: await importRoomKey(raw), recoveryKey: base64(raw) };
}

export async function deriveRoomKey(prfOutput, room) {
  const material = await crypto.subtle.importKey("raw", typeof prfOutput === "string" ? fromBase64(prfOutput) : bytes(prfOutput), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: associatedData(room), info: textEncoder.encode("Things Web room key") }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptUpdate(update, key, room, version = 1) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: associatedData(room, version) }, key, bytes(update));
  return { version, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
}

export async function decryptUpdate(envelope, key, room) {
  if (!envelope || envelope.version !== 1 || typeof envelope.nonce !== "string" || typeof envelope.ciphertext !== "string") throw new TypeError("Invalid encrypted update");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.nonce), additionalData: associatedData(room, envelope.version) }, key, fromBase64(envelope.ciphertext));
  return new Uint8Array(plaintext);
}

export function encodeBytes(value) { return base64(value); }
export function decodeBytes(value) { return fromBase64(value); }
export async function exportRoomKey(key) { return base64(new Uint8Array(await crypto.subtle.exportKey("raw", key))); }
