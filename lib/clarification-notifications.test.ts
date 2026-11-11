import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

function loadModule<T>(filename: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => dependencies[name] ?? {},
    console: { error() {} },
    Error,
  }, { filename });
  return exports as T;
}

type Account = { id: string; contestId: number; role: string };
type Session = { userId: string; contestId: number; role: string };
const staff = { id: "judge-a", contestId: 1001, role: "JUDGE" };
const session = { userId: staff.id, contestId: staff.contestId, role: staff.role };

function fixture(options: {
  global?: { userId: string; isGlobalAdmin: boolean };
  session?: Session | Error | null;
  account?: Account | null;
  access?: boolean;
  fail?: boolean;
} = {}) {
  const currentSession = options.session === undefined ? session : options.session;
  const account = options.account === undefined ? staff : options.account;
  const scopes: number[] = [];
  let accountReads = 0;
  const auth = {
    getCurrentSuper: async () => options.global ?? null,
    getCurrentUser: async () => currentSession,
    verifyAuth: async () => currentSession,
  };
  const manager = loadModule("lib/contest-management-auth.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "signed-session" }) }) },
    "./auth": auth,
    "./contest-access": { hasContestAccess: async () => options.access !== false },
    "./prisma": { prisma: { user: { findUnique: async ({ where }: { where: { id: string } }) => {
      accountReads++;
      assert.equal(where.id, session.userId);
      return account;
    } } } },
  });
  const route = loadModule<{ GET(request?: Request): Promise<Response> }>(
    "app/api/clarifications/notifications/route.ts",
    {
      "next/server": { NextResponse },
      "@/lib/auth": auth,
      "@/lib/contest-management-auth": manager,
      "@/lib/prisma": { prisma: {} },
      "@/lib/clarification-notifications": { getPendingClarifications: async (_db: unknown, contestId: number) => {
        scopes.push(contestId);
        if (options.fail) throw new Error("Private database error");
        return { total: 1, questions: [{ id: 1, contestId, title: "Private contestant question" }] };
      } },
    },
  );
  return { route, scopes, get accountReads() { return accountReads; } };
}

test("guests and invalid sessions cannot read question notifications", async () => {
  for (const session of [null, new Error("Expired session")]) {
    const f = fixture({ session });
    const response = await f.route.GET();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(f.scopes.length, 0);
  }
});

test("super administrators never receive notifications, even with a staff session", async () => {
  for (const currentSession of [null, session]) {
    const f = fixture({ global: { userId: "super-admin", isGlobalAdmin: true }, session: currentSession });
    const response = await f.route.GET();
    assert.equal(response.status, 403);
    assert.equal(f.accountReads, 0);
    assert.equal(f.scopes.length, 0);
    assert.equal((await response.json()).questions, undefined);
  }
});

test("only current contest ADMIN and JUDGE roles receive their own contest's questions", async () => {
  for (const role of ["ADMIN", "JUDGE", "TEAM", "BALLOON", "PRINT", "OBSERVER"]) {
    // The old JWT says ADMIN; the current database role decides access.
    const f = fixture({ session: { ...session, role: "ADMIN" }, account: { ...staff, role } });
    const response = await f.route.GET(new Request("https://example.test/api/clarifications/notifications?contestId=1002"));
    const allowed = role === "ADMIN" || role === "JUDGE";
    assert.equal(response.status, allowed ? 200 : 403, role);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(f.scopes, allowed ? [1001] : [], role);
    const body = await response.json();
    if (allowed) {
      assert.equal(body.viewerKey, `contest-${staff.id}`);
      assert.equal(body.questions[0].contestId, 1001);
    } else {
      assert.equal(body.questions, undefined);
    }
  }
});

test("deleted users, moved users and locked private contests cannot read questions", async () => {
  for (const options of [
    { account: null },
    { account: { ...staff, contestId: 1002 } },
    { access: false },
  ]) {
    const f = fixture(options);
    const response = await f.route.GET();
    assert.equal(response.status, 403);
    assert.equal(f.scopes.length, 0);
  }
});

test("ordinary global accounts have no notification access without a contest staff session", async () => {
  const f = fixture({ global: { userId: "ordinary", isGlobalAdmin: false }, session: null });
  assert.equal((await f.route.GET()).status, 401);
  assert.equal(f.scopes.length, 0);
});

test("notification failures do not expose database details or become cacheable", async () => {
  const f = fixture({ fail: true });
  const response = await f.route.GET();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.doesNotMatch(await response.text(), /Private database error/);
});
