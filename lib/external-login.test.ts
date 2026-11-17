import assert from "node:assert/strict";
import test from "node:test";
import { externalLoginEnabled } from "./external-login";
import { getSiteConfig } from "./site-config";

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

test("site branding defaults to generic copy and sanitizes external login provider links", () => {
  const defaults = getSiteConfig({});
  assert.equal(defaults.name, "NovaJudge");
  assert.equal(defaults.externalLoginLabel, "");
  assert.equal(defaults.externalLoginUrl, "");

  const configured = getSiteConfig({
    NOVAJUDGE_EXTERNAL_LOGIN_LABEL: " 校园统一身份认证 ",
    NOVAJUDGE_EXTERNAL_LOGIN_URL: " https://sso.example.edu/ ",
  });
  assert.equal(configured.externalLoginLabel, "校园统一身份认证");
  assert.equal(configured.externalLoginUrl, "https://sso.example.edu/");

  const unsafe = getSiteConfig({
    NOVAJUDGE_EXTERNAL_LOGIN_LABEL: "Portal",
    NOVAJUDGE_EXTERNAL_LOGIN_URL: "javascript:alert(1)",
  });
  assert.equal(unsafe.externalLoginUrl, "");
});
