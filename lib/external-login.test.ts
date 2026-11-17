import assert from "node:assert/strict";
import test from "node:test";
import { externalLoginEnabled } from "./external-login";

test("new sites do not enable external login just by configuring a provider", () => {
  assert.equal(externalLoginEnabled(null, "https://auth.example.test/login"), false);
  assert.equal(externalLoginEnabled({ allowExternalLogin: false }, "https://auth.example.test/login"), false);
});

test("an existing enabled preference survives an upgrade and needs a configured provider", () => {
  assert.equal(externalLoginEnabled({ allowExternalLogin: true }, "https://auth.example.test/login"), true);
  for (const url of ["", "not-a-url", "file:///tmp/auth", "javascript:alert(1)"]) {
    assert.equal(externalLoginEnabled({ allowExternalLogin: true }, url), false);
  }
});
