import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import { externalLoginEnabled } from "./external-login";

function harness(setting: { allowExternalLogin: boolean } | null, banned = false, authUrl = "https://auth.example.test/login") {
  let requests = 0;
  let saved = 0;
  let signed = 0;
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/external-login": { externalLoginEnabled },
    "@/lib/auth": { signAuth: async (payload: { isGlobalAdmin: boolean }) => {
      signed++;
      assert.equal(payload.isGlobalAdmin, false);
      return "test-session";
    } },
    "@/lib/prisma": { prisma: {
      systemSetting: { findUnique: async () => setting },
      globalUser: { upsert: async (args: { create: Record<string, unknown> }) => {
        saved++;
        assert.equal(args.create.role, "GLOBAL_USER");
        return { ...args.create, id: "global-1", isBanned: banned };
      } },
    } },
  };
  const filename = "app/api/auth/external/password-login/route.ts";
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as { POST(request: Request): Promise<Response> };
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    process: { env: { EXTERNAL_AUTH_URL: authUrl, APP_KEY: "provider-secret" } },
    fetch: async () => {
      requests++;
      return { ok: true, json: async () => ({ code: 200, data: { userId: 12, userAccount: "student", realName: "Student", numberId: "2026" } }) };
    },
  });
  return { post: () => exports.POST(new Request("https://oj.example.test/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "student", password: "password" }),
  })), counts: () => ({ requests, saved, signed }) };
}

test("unconfigured and disabled external login never contacts the provider or writes accounts", async () => {
  for (const [setting, url] of [[null, "https://auth.example.test/login"], [{ allowExternalLogin: false }, "https://auth.example.test/login"], [{ allowExternalLogin: true }, ""]] as const) {
    const app = harness(setting, false, url);
    assert.equal((await app.post()).status, 403);
    assert.deepEqual(app.counts(), { requests: 0, saved: 0, signed: 0 });
  }
});

test("an existing enabled external account can log in without exposing the provider secret", async () => {
  const app = harness({ allowExternalLogin: true });
  const response = await app.post();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /student/);
  assert.doesNotMatch(body, /provider-secret/);
  assert.match(response.headers.get("set-cookie")!, /auth_token=test-session/);
  assert.deepEqual(app.counts(), { requests: 1, saved: 1, signed: 1 });
});

test("banned external accounts do not receive a new session", async () => {
  const app = harness({ allowExternalLogin: true }, true);
  assert.equal((await app.post()).status, 403);
  assert.equal(app.counts().signed, 0);
});
