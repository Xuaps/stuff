# Things Web — Plan

A web clone of Things 3. Things features that can't be cloned get a web-native
replacement:

| Things 3 feature            | Not clonable because            | Web replacement |
|-----------------------------|----------------------------------|-----------------|
| Things Cloud sync           | proprietary Apple-only service   | Local-first CRDT (**Yjs**) + tiny sync server (`y-websocket`), E2E encrypted |
| iCloud account              | Apple ID                         | **WebAuthn passkey** — no passwords; passkey PRF derives the E2EE key |
| macOS/iOS native apps       | App Store                        | **PWA** — installable, offline-first (service worker), Dock icon |
| Quick Entry (Ctrl+Space)    | global OS hotkey                 | In-app `Cmd/Ctrl+K` palette + **Web Share Target** (capture from any app) |
| Natural-language dates      | clonable                         | **chrono-node** (open source, same idea) |
| Reminders/Notifications     | APNs                             | **Web Push** + Notification API |
| Siri / Shortcuts            | Apple-only                       | URL scheme (`/add?title=...&when=today`) + share target |
| Mail to Things              | email infra                      | Share target covers 95% — skip |
| Apple Watch / widgets       | watchOS                          | Skip — out of scope |
| Shake to undo               | mobile gesture                   | `Cmd/Ctrl+Z` undo stack (command pattern) |

## Stack (lazy but real)

- **No build step.** Vanilla ES modules + a tiny component helper. Adding React/Svelte for a todo app is complexity for its own sake; revisit only if rendering perf measurably hurts.
- **Storage: IndexedDB via Dexie** (~8kb). Schema versioned, mirrors the entity model below.
- **Sync (phase 6 only): Yjs.** The data model is written CRDT-ready from day 1 (immutable field updates, tombstones, no array-index-dependent ordering → fractional-index position strings), so adding sync later is additive, not a rewrite.
- **Design: hand-rolled CSS** using Things' actual visual language (SF-like system font stack, 6px radii, generous whitespace, subtle hover states, animated checkbox). No framework CSS — Things' look *is* the whitespace.
- Libraries total: `dexie`, `chrono-node`, later `yjs` + `y-websocket` + `y-indexeddb`. That's it.

## Data model (sync-ready)

```
Area    { id, title, pos, tombstone? }
Project { id, title, notes, areaId?, when, deadline?, pos, done, tombstone? }
Heading { id, title, projectId, pos, tombstone? }
Task    { id, title, notes, projectId?, headingId?, tags[],
          when: 'inbox'|'someday'|YYYY-MM-DD, evening, deadline?,
          checklist[{id,title,done,pos}], pos, done, doneAt?, tombstone? }
```
`pos` = fractional index string (`"a0"`, `"a1"`…) so reordering never renumbers siblings (CRDT-compatible).

## Phases — each ends in a shippable state

**Phase 0 — Make current app actually work (½ day)**
- Fix the date-prefill regex (done).
- Open every view, click every button, fix what breaks. No new features.

**Phase 1 — Design parity pass (1–2 days)** ← fixes "design is very bad"
- Rebuild the CSS from Things screenshots: sidebar (list icons with Things' glyph style, counts, collapsible areas), task rows (circle checkbox with fill animation on complete, notes preview, pill styling), view headers, empty states.
- Micro-interactions that sell the clone: checkbox strike-through animation, new-task row slide-in, hover reveal of star.
- Dark mode via `prefers-color-scheme`.

**Phase 2 — Structural split + Dexie (½ day)**
- `index.html` + `app/` ES modules (`store.js`, `views.js`, `task.js`…). Same app, just navigable.
- localStorage → IndexedDB migration on first load.

**Phase 3 — Interaction parity (2 days)**
- Drag & drop: reorder tasks, drop onto projects/areas in sidebar, drop onto "Today" to schedule. SortableJS or hand-rolled pointer events (~100 lines, hand-rolled preferred).
- Headings inside projects; checklists inside tasks.
- Multi-select (shift/cmd-click), keyboard shortcut sheet (`?`), undo (`Cmd+Z`) via command stack.

**Phase 4 — Smart input (½ day)**
- `chrono-node` in the new-task field: "call dentist friday 5pm !" → when=Friday, deadline parsing, `#tag` and `[[project]]` inline.
- `Cmd/Ctrl+K` quick-entry palette.

**Phase 5 — PWA (½ day)**
- Manifest + service worker (cache-first shell, IndexedDB is already offline). Installable, works with no network. App shortcut "New To-Do" from the Dock icon.
- Web Share Target → "share a page/photo to Things Web" creates an inbox task.

**Phase 6 — Sync + passkeys (2–3 days) — OPTIONAL, only if multi-device matters**
- Server: one small Node process running `y-websocket` (deploy on Fly/Railway/a VPS; ~50 lines).
- Client: swap Dexie persistence for `y-indexeddb` + `y-websocket` provider. Data model is already CRDT-ready, so no schema rewrite.
- WebAuthn: register passkey → server stores credential; sync rooms keyed by credential ID. E2EE: encrypt Yjs updates with a key derived from the passkey PRF (falls back to device key in IndexedDB if PRF unsupported).
- Web Push for deadlines (VAPID, server stores subscriptions).

**Explicitly not building:** collaboration/sharing, email ingress, watch app, real-time cursors. YAGNI — the architecture doesn't preclude them.

## Order rationale
Phases 0–5 are fully local and each stands alone — you can stop after 5 and have a
complete, beautiful, offline app. Phase 6 is the only one with a server and is
isolated behind the storage layer, so it's purely additive.
