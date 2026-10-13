import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { proctoringAccessAllowed, proctoringKeyHash } from "./proctoring-access";

test("ordinary accounts stay usable until proctoring binds the account", () => {
  assert.equal(proctoringAccessAllowed(null, {}, null), true);
  assert.equal(proctoringAccessAllowed(null, { loginSource: "PROCTORING" }, null), false);
});

test("a proctored JWT requires the matching client proof and current database binding", () => {
  const key = randomBytes(32).toString("base64url");
  const hash = proctoringKeyHash(key);
  const payload = { loginSource: "PROCTORING", proctoringKeyHash: hash };
  assert.equal(proctoringAccessAllowed(hash, payload, key), true);
  for (const value of [null, "PROCTORING", "a".repeat(43), key + "x"]) {
    assert.equal(proctoringAccessAllowed(hash, payload, value), false);
  }
  assert.equal(proctoringAccessAllowed(hash, {}, key), false, "old ordinary-browser tokens are revoked");
  assert.equal(proctoringAccessAllowed(proctoringKeyHash("b".repeat(43)), payload, key), false, "relogin revokes previous monitor credentials");
});
