import test from "node:test";
import assert from "node:assert/strict";
import { decryptUpdate, encryptUpdate, generateRoomKey } from "./crypto.js";

test("AES-GCM update roundtrip and wrong key rejection", async () => {
  const first = await generateRoomKey();
  const second = await generateRoomKey();
  const envelope = await encryptUpdate(new Uint8Array([1, 2, 3]), first.key, "room-a");
  assert.deepEqual([...await decryptUpdate(envelope, first.key, "room-a")], [1, 2, 3]);
  await assert.rejects(() => decryptUpdate(envelope, second.key, "room-a"));
  await assert.rejects(() => decryptUpdate(envelope, first.key, "room-b"));
});
