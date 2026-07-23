import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDurableStore } from "./store.js";

test("opaque envelopes and scheduled jobs survive a store restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "things-sync-"));
  const file = join(directory, "data.json");
  const envelope = { version: 1, nonce: "n", ciphertext: "opaque" };
  const first = await createDurableStore(file);
  await first.addUpdate("room", envelope);
  await first.addJob({ id: "job", room: "room", sendAt: 1, payload: envelope });
  const second = await createDurableStore(file);
  assert.deepEqual(second.updates("room"), [envelope]);
  assert.deepEqual(await second.dueJobs(1), [{ id: "job", room: "room", sendAt: 1, payload: envelope }]);
  assert.match(await readFile(file, "utf8"), /opaque/);
});

test("jobs are only durable-sent when explicitly marked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "things-sync-"));
  const store = await createDurableStore(join(directory, "data.json"));
  const job = { id: "job", room: "r", sendAt: 1, payload: { version: 1, nonce: "n", ciphertext: "c" } };
  await store.addJob(job);
  assert.equal((await store.dueJobs(1)).length, 1);
  await store.markJob(job, 2);
  assert.equal((await store.dueJobs(1)).length, 0);
});

test("job keys upsert within a room and ownership is enforced on removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "things-sync-"));
  const store = await createDurableStore(join(directory, "data.json"));
  const payload = { version: 1, nonce: "n", ciphertext: "c" };
  await store.addJob({ id: "job", room: "one", jobKey: "opaque", taskId: "task", sendAt: 1, payload });
  await store.addJob({ id: "other", room: "one", jobKey: "opaque", taskId: "task", sendAt: 2, payload });
  assert.equal(store.data.jobs.length, 1);
  assert.equal(await store.removeJob("job", "two"), false);
  assert.equal(await store.removeJob("job", "one"), true);
});
