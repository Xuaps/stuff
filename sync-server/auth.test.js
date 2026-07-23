import test from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_SECRET ||= "explicit-test-secret";
const { createToken, verifyToken } = await import("./index.js");

test("access tokens are signed and reject tampering", () => {
  const token = createToken("room");
  assert.equal(verifyToken(token).room, "room");
  assert.equal(verifyToken(`${token}x`), null);
  assert.equal(verifyToken("not-a-token"), null);
});
