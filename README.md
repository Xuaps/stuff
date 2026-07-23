# stuff — Things Web

A local-first web clone of Things 3. The default app is local-only: tasks stay in IndexedDB and no sync/CDN request is made until Sync is explicitly configured.

## Develop

- `npm test` — unit and CRDT tests
- `npm run test:server` — durable sync-server tests
- `npm run test:e2e` — Playwright PWA tests
- `TOKEN_SECRET=$(openssl rand -hex 32) node sync-server/index.js` — local sync server on `http://localhost:8787`
- `npm run test:all` — all checks

### Sync server environment

`PORT` (8787), `RP_ID` (localhost), `ORIGIN` (WebAuthn origin), `CORS_ORIGINS` (comma-separated exact origins), `DATA_FILE` (durable JSON file), `TOKEN_SECRET` (always required; use a stable strong secret), `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`. Generate VAPID keys with `npx web-push generate-vapid-keys`.

The server can be deployed as the included Docker image to Fly.io, Railway, or a VPS. GitHub Pages can host the static PWA, but cannot host the WebSocket sync backend. Keep `DATA_FILE` on a persistent volume.

## Privacy and recovery

Task data is encrypted in the browser with AES-GCM. The server sees room IDs, credential metadata, opaque encrypted envelopes, subscriptions, and delivery times, but not task content. Passkey PRF derives a room key when supported. Otherwise the app generates an exportable recovery key, keeps a device copy in IndexedDB, and requires Copy/Import on another device; a device-only key does **not** sync by itself.

Sync uses a small custom encrypted WebSocket protocol instead of y-websocket so the server stores opaque envelopes intentionally.

## Roadmap

See #1 for the original spec and issues #2–#12 for vertical slices.
