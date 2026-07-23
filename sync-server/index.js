import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import webpush from "web-push";
import { createDurableStore, hashToken } from "./store.js";

const PORT = Number(process.env.PORT || 8787);
const RP_ID = process.env.RP_ID || "localhost";
const ORIGIN = process.env.ORIGIN || `http://${RP_ID}:${PORT}`;
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS || "http://localhost:8787,http://localhost:5173").split(",").map(value => value.trim()).filter(Boolean));
const DATA_FILE = process.env.DATA_FILE || new URL("./data.json", import.meta.url).pathname;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) throw new Error("TOKEN_SECRET environment variable is required to start the sync server");
const challenges = new Map();
const rooms = new Map();
const store = await createDurableStore(DATA_FILE);

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !CORS_ORIGINS.has(origin)) return json(response, 403, { error: "origin_not_allowed" });
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return json(response, 204, null);
  }
  const url = new URL(request.url, ORIGIN);
  try {
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") return json(response, 404, { error: "not_found" });
    const body = request.method === "POST" ? await readBody(request) : {};
    if (url.pathname === "/auth/register/options") return registerOptions(response, body);
    if (url.pathname === "/auth/register/verify") return registerVerify(response, body);
    if (url.pathname === "/auth/login/options") return loginOptions(response, body);
    if (url.pathname === "/auth/login/verify") return loginVerify(response, body);
    if (url.pathname === "/auth/refresh") return refresh(response, body);
    const auth = authenticate(request);
    if (!auth) return json(response, 401, { error: "unauthorized" });
    if (url.pathname === "/push/subscribe") {
      if (!body?.subscription?.endpoint) return json(response, 400, { error: "subscription_required" });
      await store.addSubscription({ room: auth.room, subscription: body.subscription });
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/push/jobs" && request.method === "GET") return listJobs(response, auth.room);
    if (url.pathname === "/push/jobs" && request.method === "POST") return scheduleJob(response, body, auth.room);
    if (request.method === "DELETE" && url.pathname.startsWith("/push/jobs/")) {
      const removed = await store.removeJob(decodeURIComponent(url.pathname.slice("/push/jobs/".length)), auth.room);
      return removed ? json(response, 200, { ok: true }) : json(response, 404, { error: "not_found" });
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    return json(response, 400, { error: "bad_request" });
  }
});

const websocket = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, ORIGIN);
  if (!url.pathname.startsWith("/room/")) return socket.destroy();
  websocket.handleUpgrade(request, socket, head, client => websocket.emit("connection", client, request, url));
});
websocket.on("connection", (client, request, url) => {
  const room = decodeURIComponent(url.pathname.slice("/room/".length));
  let authenticated = false;
  client.on("message", async raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (!authenticated && message.type === "hello") {
        const auth = verifyToken(message.token);
        if (!auth || auth.room !== room || message.room !== room) return client.close(1008, "unauthorized");
        authenticated = true;
        (rooms.get(room) || rooms.set(room, new Set()).get(room)).add(client);
        for (const envelope of store.updates(room)) client.send(JSON.stringify({ type: "update", room, envelope }));
        return;
      }
      if (!authenticated || message.type !== "update" || message.room !== room || !validEnvelope(message.envelope)) return client.close(1008, "invalid_update");
      await store.addUpdate(room, message.envelope);
      for (const peer of rooms.get(room) || []) if (peer !== client && peer.readyState === 1) peer.send(JSON.stringify({ type: "update", room, envelope: message.envelope }));
      if (client.readyState === 1) client.send(JSON.stringify({ type: "ack", count: 1 }));
    } catch { client.close(1008, "invalid_message"); }
  });
  client.on("close", () => rooms.get(room)?.delete(client));
});

let schedulerRunning = false;
setInterval(async () => {
  if (schedulerRunning || !webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return;
  schedulerRunning = true;
  try {
    for (const job of await store.dueJobs()) {
      const recipients = store.data.subscriptions.filter(item => item.room === job.room);
      let delivered = true;
      for (const recipient of recipients) {
        try {
          await webpush.sendNotification(recipient.subscription, JSON.stringify({ type: "deadline", payload: job.payload }));
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            store.data.subscriptions = store.data.subscriptions.filter(item => item !== recipient);
            await store.save();
          } else delivered = false;
        }
      }
      if (delivered) await store.markJob(job);
    }
  } finally { schedulerRunning = false; }
}, 1000).unref();

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(PORT, () => console.log(`Things sync server listening on ${PORT}`));
export { server, store, validEnvelope, createToken, verifyToken };

async function registerOptions(response, body) {
  const userId = crypto.randomBytes(16);
  const options = await generateRegistrationOptions({
    rpName: "Things Web", rpID: RP_ID, userID: userId, userName: String(body?.username || `things-${userId.toString("hex")}`),
    attestationType: "none", authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    extensions: { prf: { eval: { first: base64(crypto.randomBytes(32)) } } },
  });
  challenges.set(options.challenge, { type: "register", userId: base64(userId), userName: options.user.name, prfSalt: options.extensions?.prf?.eval?.first });
  return json(response, 200, options);
}

async function registerVerify(response, body) {
  const challenge = String(body?.challenge || "");
  const expected = challenges.get(challenge);
  if (!expected || expected.type !== "register") return json(response, 400, { error: "challenge_expired" });
  const result = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
  challenges.delete(challenge);
  if (!result.verified || !result.registrationInfo) return json(response, 400, { error: "registration_failed" });
  const credential = result.registrationInfo.credential || result.registrationInfo;
  const id = credential.id || body.response?.id;
  await store.addCredential({ id, publicKey: base64(credential.publicKey), counter: credential.counter || 0, userName: expected.userName, prfSalt: expected.prfSalt });
  return json(response, 200, await session(id));
}

async function loginOptions(response, body) {
  const room = body?.room;
  const credential = room ? store.credential(room) : null;
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "preferred", ...(room ? { allowCredentials: [{ id: room }] } : {}), ...(credential?.prfSalt ? { extensions: { prf: { eval: { first: credential.prfSalt } } } } : {}) });
  challenges.set(options.challenge, { type: "login", room, prfSalt: credential?.prfSalt });
  return json(response, 200, options);
}

async function loginVerify(response, body) {
  const challenge = String(body?.challenge || "");
  const expected = challenges.get(challenge);
  if (!expected || expected.type !== "login") return json(response, 400, { error: "challenge_expired" });
  const id = body.response?.id;
  const credential = store.credential(id);
  if (!credential || (expected.room && expected.room !== id)) return json(response, 401, { error: "unknown_credential" });
  const result = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential: { id, publicKey: fromBase64(credential.publicKey), counter: credential.counter } });
  challenges.delete(challenge);
  if (!result.verified) return json(response, 401, { error: "authentication_failed" });
  credential.counter = result.authenticationInfo.newCounter;
  await store.save();
  return json(response, 200, await session(id));
}

async function refresh(response, body) {
  const refreshToken = String(body?.refreshToken || "");
  const next = createRefreshToken();
  const room = await store.rotateRefreshToken(hashToken(refreshToken), { tokenHash: hashToken(next.value), expiresAt: next.expiresAt });
  if (!room) return json(response, 401, { error: "refresh_invalid" });
  return json(response, 200, { token: createToken(room), refreshToken: next.value });
}

async function session(room) {
  const refresh = createRefreshToken();
  await store.addRefreshToken(room, hashToken(refresh.value), refresh.expiresAt);
  return { token: createToken(room), refreshToken: refresh.value, room, vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "" };
}
function createRefreshToken() { return { value: base64(crypto.randomBytes(32)), expiresAt: Date.now() + 30 * 24 * 60 * 60e3 }; }

async function scheduleJob(response, body, room) {
  const payload = body?.payload;
  if (!Number.isFinite(body?.sendAt) || !validEnvelope(payload) || typeof body?.jobKey !== "string" || !body.jobKey) return json(response, 400, { error: "encrypted_payload_required" });
  const existing = store.data.jobs.find(job => job.room === room && job.jobKey === body.jobKey);
  const job = { id: existing?.id || crypto.randomUUID(), room, taskId: String(body.taskId || ""), jobKey: body.jobKey, sendAt: Number(body.sendAt), payload };
  await store.addJob(job);
  return json(response, 202, { id: job.id, jobKey: job.jobKey });
}
function listJobs(response, room) { return json(response, 200, { jobs: store.jobs(room) }); }

function authenticate(request) { return verifyToken(String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")); }
function createToken(room) {
  const payload = base64(JSON.stringify({ room, exp: Date.now() + 15 * 60e3 }));
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  const [payload, signature] = String(token || "").split(".");
  const expected = payload ? sign(payload) : "";
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const value = JSON.parse(Buffer.from(payload, "base64url").toString()); return value.exp > Date.now() ? value : null; } catch { return null; }
}
function sign(value) { return crypto.createHmac("sha256", TOKEN_SECRET).update(value).digest("base64url"); }
function validEnvelope(value) {
  return value && value.version === 1 && typeof value.nonce === "string" && typeof value.ciphertext === "string" && Object.keys(value).length === 3;
}
function base64(value) { return Buffer.from(value).toString("base64url"); }
function fromBase64(value) { return new Uint8Array(Buffer.from(value, "base64url")); }
function json(response, status, value) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(value == null ? "" : JSON.stringify(value)); }
async function readBody(request) {
  let text = "";
  for await (const chunk of request) { text += chunk; if (text.length > 1e6) throw new Error("body_too_large"); }
  return text ? JSON.parse(text) : {};
}
