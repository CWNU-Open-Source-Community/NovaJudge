import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as cookie from "cookie";
import { NextRequest, NextResponse } from "next/server";
import ts from "typescript";
import * as tokens from "./contest-access-token";
import * as crypto from "node:crypto";
import * as proctoring from "./proctoring-access";
import * as cliPolicy from "./cli-device-policy";
import { Verdict } from "./generated/prisma/enums";

const secret = new TextEncoder().encode("contest-api-access-regression-secret");
const privateContest = { id: 1001, title: "Private contest", status: "RUNNING", type: "PRIVATE", password: "private password" };
type Route = {
  POST(req: Request): Promise<Response>;
  GET(req: NextRequest, context: { params: Promise<Record<string, string>> }): Promise<Response>;
};

function loadModule<T>(filename: string, dependencies: Record<string, unknown>, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, require: (name: string) => dependencies[name] ?? {},
    process: { env: {}, cwd: () => process.cwd() }, console: { error() {}, log() {} },
    Response, TextEncoder, ReadableStream, Buffer, ...globals,
  }, { filename });
  return exports as T;
}

function baseDependencies() {
  return {
    "@/lib/cli-deployment": { isCliEnabled: () => true, assertCliEnabled() {} },
    "@/lib/cli-devices": {
      CliDeviceError: cliPolicy.CliDeviceError,
      assertActiveCliContest: async () => {},
      cliErrorResponse: (error: InstanceType<typeof cliPolicy.CliDeviceError>) => NextResponse.json({ error: error.message, code: error.code }, { status: error.status }),
    },
    "@/lib/cli-settings-lock": { lockCliSettings: async () => {} },
    "next/server": { NextResponse },
    "@/lib/contest-access-token": tokens,
    "@/lib/proctoring-access": proctoring,
    "node:crypto": crypto,
    "@/lib/auth": { getJwtSecretKey: () => secret },
    "@/lib/generated/prisma/client": { Verdict, ContestStatus: { RUNNING: "RUNNING" }, ContestRole: { ADMIN: "ADMIN", TEAM: "TEAM" } },
  };
}

test("submission source export requires an enabled API key owned by a current, non-banned super administrator", async () => {
  const cases = [
    { key: "", role: "SUPER_ADMIN", enabled: true, banned: false, allowed: false },
    { key: "invalid", role: "SUPER_ADMIN", enabled: true, banned: false, allowed: false },
    { key: "existing-key", role: "GLOBAL_USER", enabled: true, banned: false, allowed: false },
    { key: "existing-key", role: "SUPER_ADMIN", enabled: false, banned: false, allowed: false },
    { key: "existing-key", role: "SUPER_ADMIN", enabled: true, banned: true, allowed: false },
    { key: "existing-key", role: "SUPER_ADMIN", enabled: true, banned: false, allowed: true },
  ];
  // Knowing a private contest's password must not grant source-export access either.
  for (const contestGate of [200, 403, 404]) {
    for (const scenario of cases) {
      let sourceReads = 0;
      const db = {
        apiKey: {
          findUnique: async ({ where }: { where: { key: string } }) => where.key === "existing-key" ? {
            id: "key-id", isEnabled: scenario.enabled,
            user: { id: "key-owner", role: scenario.role, isBanned: scenario.banned },
          } : null,
          update: async () => {},
        },
        submission: { findMany: async () => {
          sourceReads++;
          return [{ id: "live-submission", verdict: Verdict.ACCEPTED, code: "private source", language: "cpp", submittedAt: new Date() }];
        } },
      };
      const auth = loadModule<typeof import("./auth")>("lib/auth.ts", {
        "@/lib/prisma": { prisma: db },
      });
      const route = loadModule<Route>("app/api/contests/[contestId]/submissions/route.ts", {
        ...baseDependencies(),
        "@/lib/auth": auth,
        "@/lib/prisma": { prisma: db },
        "@/lib/contest-access": { contestAccessResponse: async () => contestGate === 200 ? null : NextResponse.json({ error: "Denied" }, { status: contestGate }) },
      });
      const response = await route.GET(new NextRequest("https://example.test/api/contests/1001/submissions", {
        headers: scenario.key ? { "x-api-key": scenario.key } : {},
      }), { params: Promise.resolve({ contestId: "1001" }) });
      const expectedStatus = scenario.allowed ? (contestGate === 404 ? 404 : 200) : 403;
      assert.equal(response.status, expectedStatus, JSON.stringify({ ...scenario, contestGate }));
      assert.equal(sourceReads, expectedStatus === 200 ? 1 : 0);
      const body = await response.json();
      if (expectedStatus === 200) {
        assert.equal(body[0].code, "private source");
        assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      } else {
        assert.equal(JSON.stringify(body).includes("private source"), false);
      }
    }
  }
});

test("logout expires both login cookies and every contest grant in real response headers", async () => {
  const route = loadModule<Route>("app/api/auth/logout/route.ts", {
    ...baseDependencies(), cookie,
    "next/headers": { cookies: async () => ({ getAll: () => [
      { name: "auth_token", value: "admin" }, { name: "user_token", value: "team" },
      { name: "contest_access_1001", value: "grant1" }, { name: "contest_access_1002", value: "grant2" },
      { name: "theme", value: "dark" },
    ] }) },
  });
  const response = await route.POST(new Request("https://example.test/"));
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 4);
  for (const name of ["auth_token", "user_token", "contest_access_1001", "contest_access_1002"]) {
    const value = cookies.find((entry) => entry.startsWith(`${name}=`));
    assert.ok(value, `missing deletion for ${name}`);
    assert.match(value, /Max-Age=(?:-1|0)(?:;|$)/);
    assert.match(value, /Path=\//);
  }
});

test("CLI login requires the separate contest password and returns a grant without leaking the password", async () => {
  for (const password of [undefined, "wrong", privateContest.password]) {
    let accountUpdates = 0;
    const route = loadModule<Route>("app/api/cli/login/route.ts", {
      ...baseDependencies(),
      bcryptjs: { compare: async () => true },
      "@/lib/auth": { getJwtSecretKey: () => secret, signAuth: async () => "account-token" },
      "@/lib/request-ip": { getPrimaryClientIp: () => null },
      "@/lib/prisma": { prisma: { user: {
        findUnique: async () => ({ id: "team", username: "team", password: "hash", role: "TEAM", contestId: 1001, contest: privateContest }),
        update: async () => { accountUpdates++; },
      } } },
    });
    const response = await route.POST(new Request("https://example.test/", {
      method: "POST", body: JSON.stringify({ username: "team", password: "account-password", contestId: 1001, contestPassword: password }),
    }));
    const data = await response.json();
    if (password !== privateContest.password) {
      assert.equal(response.status, 403);
      assert.equal(data.code, "CONTEST_PASSWORD_REQUIRED");
      assert.equal(accountUpdates, 0);
      assert.equal(data.token, undefined);
      assert.equal(data.contest, undefined);
    } else {
      assert.equal(response.status, 200);
      assert.equal(accountUpdates, 1);
      assert.equal(data.token, "account-token");
      assert.equal(await tokens.verifyContestAccessToken(data.contestAccessToken, privateContest, secret), true);
      assert.equal(data.contest.password, undefined);
      assert.equal(JSON.stringify(data).includes(privateContest.password), false);
    }
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});

test("CLI contest grants reject missing, cross-contest, and revoked credentials", async () => {
  let contest = { ...privateContest };
  const api = loadModule<{ cliContestAccessResponse(req: Request, id: number): Promise<Response | null> }>("app/api/cli/contest-access.ts", {
    ...baseDependencies(),
    "@/lib/prisma": { prisma: { contest: { findUnique: async () => contest } } },
  });
  const valid = await tokens.signContestAccessToken(contest, secret);
  const other = await tokens.signContestAccessToken({ ...contest, id: 1002 }, secret);
  const request = (token: string) => new Request("https://example.test/", { headers: { "x-contest-access-token": token } });
  for (const token of ["", "invalid", other]) {
    assert.equal((await api.cliContestAccessResponse(request(token), 1001))?.status, 403);
  }
  assert.equal(await api.cliContestAccessResponse(request(valid), 1001), null);
  contest = { ...contest, password: "changed" };
  assert.equal((await api.cliContestAccessResponse(request(valid), 1001))?.status, 403);
  contest = { ...contest, type: "PUBLIC" };
  assert.equal(await api.cliContestAccessResponse(request(""), 1001), null);
});

test("public deployment keeps private proctoring login with contest password and administrator authorization", async () => {
  const cases = [
    { contestPassword: "", apiKey: "admin", role: "TEAM", allowed: false },
    { contestPassword: "wrong", apiKey: "admin", role: "TEAM", allowed: false },
    { contestPassword: privateContest.password, apiKey: "", role: "TEAM", allowed: false },
    { contestPassword: privateContest.password, apiKey: "ordinary", role: "TEAM", allowed: false },
    { contestPassword: privateContest.password, apiKey: "admin", role: "ADMIN", allowed: false },
    { contestPassword: privateContest.password, apiKey: "admin", role: "TEAM", allowed: true },
  ];
  for (const scenario of cases) {
    const updates: Array<Record<string, unknown>> = [];
    const signedPayloads: Array<Record<string, unknown>> = [];
    const route = loadModule<Route>("app/api/cli/login/route.ts", {
      ...baseDependencies(), bcryptjs: { compare: async () => true },
      "@/lib/cli-deployment": { assertCliEnabled: () => { throw new cliPolicy.CliDeviceError("CLI disabled", 403, "CLI_DISABLED"); } },
      "@/lib/auth": {
        getJwtSecretKey: () => secret,
        validateApiKey: async (key: string) => key === "admin" ? { role: "SUPER_ADMIN" } : key === "ordinary" ? { role: "GLOBAL_USER" } : null,
        signAuth: async (payload: Record<string, unknown>) => { signedPayloads.push(payload); return "proctor-account-token"; },
      },
      "@/lib/request-ip": { getPrimaryClientIp: () => null },
      "@/lib/prisma": { prisma: { user: {
        findUnique: async () => ({ id: "team", username: "team", password: "hash", role: scenario.role, contestId: 1001, contest: privateContest }),
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); },
      } } },
    });
    const response = await route.POST(new Request("https://example.test/", {
      method: "POST", headers: { "x-api-key": scenario.apiKey },
      body: JSON.stringify({ username: "team", password: "account-password", contestId: 1001, loginSource: "PROCTORING", contestPassword: scenario.contestPassword }),
    }));
    const data = await response.json();
    assert.equal(response.status, scenario.allowed ? 200 : 403, JSON.stringify(scenario));
    assert.equal(updates.length, scenario.allowed ? 1 : 0);
    assert.equal(signedPayloads.length, scenario.allowed ? 1 : 0);
    if (scenario.allowed) {
      assert.equal(data.loginSource, "PROCTORING");
      assert.match(data.proctoringKey, /^[A-Za-z0-9_-]{43}$/);
      const hash = proctoring.proctoringKeyHash(data.proctoringKey);
      assert.equal(updates[0].proctoringKeyHash, hash);
      assert.equal(signedPayloads[0].proctoringKeyHash, hash);
      assert.equal(signedPayloads[0].loginSource, "PROCTORING");
      assert.equal(await tokens.verifyContestAccessToken(data.contestAccessToken, privateContest, secret), true);
      assert.equal(data.contest.password, undefined);
    } else {
      assert.equal(data.token, undefined);
      assert.equal(data.contestAccessToken, undefined);
      assert.equal(data.proctoringKey, undefined);
    }
  }
});

test("correct private contest passwords cannot turn a proctored account into an ordinary CLI session", async () => {
  let writes = 0;
  const route = loadModule<Route>("app/api/cli/login/route.ts", {
    ...baseDependencies(), bcryptjs: { compare: async () => true },
    "@/lib/request-ip": { getPrimaryClientIp: () => null },
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => ({ id: "team", username: "team", password: "hash", role: "TEAM", contestId: 1001, contest: privateContest, proctoringKeyHash: "existing-binding" }),
      update: async () => { writes++; },
    } } },
  });
  const response = await route.POST(new Request("https://example.test/", {
    method: "POST", body: JSON.stringify({ username: "team", password: "account-password", contestId: 1001, contestPassword: privateContest.password }),
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "PROCTORING_CLIENT_REQUIRED");
  assert.equal(writes, 0);
});

test("IP auto-login requires a private grant and preserves the proctored-account block", async () => {
  for (const unlocked of [false, true]) {
    let lookups = 0;
    let writes = 0;
    const route = loadModule<Route>("app/api/contests/[contestId]/auto-login/route.ts", {
      ...baseDependencies(),
      "@/lib/contest-access": { contestAccessResponse: async () => unlocked ? null : new NextResponse(null, { status: 403 }) },
      "@/lib/request-ip": { getClientIpCandidates: () => ["127.0.0.1"] },
      "@/lib/prisma": { prisma: { user: {
        findFirst: async () => { lookups++; return { proctoringKeyHash: "existing-binding" }; },
        update: async () => { writes++; },
      } } },
    });
    const response = await route.GET(new NextRequest("https://example.test/api/contests/1001/auto-login"), {
      params: Promise.resolve({ contestId: "1001" }),
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), unlocked ? "/contest/1001?autoLogin=miss&error=proctoring_required" : "/contest/1001/access");
    assert.equal(lookups, unlocked ? 1 : 0);
    assert.equal(writes, 0);
    assert.equal(response.headers.has("Set-Cookie"), false);
  }
});

test("CLI context and submission reject old account tokens before reading content or creating submissions", async () => {
  for (const filename of ["app/api/cli/context/route.ts", "app/api/cli/submit/route.ts"]) {
    let effects = 0;
    const effect = () => { effects++; throw new Error("Protected data accessed before contest grant"); };
    const route = loadModule<Route>(filename, {
      ...baseDependencies(),
      "@/lib/auth": { verifyAuth: async () => ({ userId: "team", contestId: 1001, role: "TEAM" }) },
      "../contest-access": { cliContestAccessResponse: async () => NextResponse.json({ code: "CONTEST_PASSWORD_REQUIRED" }, { status: 403 }) },
      "@/lib/prisma": { prisma: { user: { findUnique: effect }, contestProblem: { findFirst: effect } } },
      "@/lib/contest-submission": { createContestSubmission: effect },
    });
    const response = await route.POST(new Request("https://example.test/", {
      method: "POST", headers: { authorization: "Bearer old-account-token" },
      body: JSON.stringify({ contestId: 1001, problem: "A", language: "cpp", code: "source" }),
    }));
    assert.equal(response.status, 403);
    assert.equal(effects, 0);
  }
});

test("CCS Basic access is restricted to non-banned super administrators", async () => {
  for (const user of [
    { role: "GLOBAL_USER", isBanned: false },
    { role: "SUPER_ADMIN", isBanned: true },
    { role: "SUPER_ADMIN", isBanned: false },
  ]) {
    const ccs = loadModule<{ checkCCSAuth(req: NextRequest): Promise<boolean> }>("lib/ccs/auth.ts", {
      ...baseDependencies(), bcryptjs: { compare: async () => true },
      "@/lib/prisma": { prisma: { globalUser: { findUnique: async () => ({ ...user, password: "hash" }) } } },
    });
    const request = new NextRequest("https://example.test/api/ccs/contests/1001", {
      headers: { authorization: `Basic ${Buffer.from("global:password").toString("base64")}` },
    });
    assert.equal(await ccs.checkCCSAuth(request), user.role === "SUPER_ADMIN" && !user.isBanned);
  }
});

test("CCS respects the active global identity over an older contest administrator cookie", async () => {
  for (const isGlobalAdmin of [false, true]) {
    let contestLookups = 0;
    const ccs = loadModule<{ checkCCSAuth(req: NextRequest): Promise<boolean> }>("lib/ccs/auth.ts", {
      ...baseDependencies(),
      "@/lib/auth": { getVerifiedGlobalUser: async () => ({ isGlobalAdmin }) },
      "@/lib/prisma": { prisma: { user: { findUnique: async () => { contestLookups++; return { contestId: 1001, role: "ADMIN" }; } } } },
    });
    const request = new NextRequest("https://example.test/api/ccs/contests/1001", {
      headers: { cookie: "auth_token=global-session; user_token=old-admin-session" },
    });
    assert.equal(await ccs.checkCCSAuth(request), isGlobalAdmin);
    assert.equal(contestLookups, 0);
  }
});

test("CCS contest access requires current proctoring proof in addition to the private grant", async () => {
  const key = crypto.randomBytes(32).toString("base64url");
  const originalHash = proctoring.proctoringKeyHash(key);
  let storedHash = originalHash;
  const grant = await tokens.signContestAccessToken(privateContest, secret);
  const ccs = loadModule<{ createCCSAuthValidator(req: NextRequest): Promise<(() => Promise<boolean>) | null> }>("lib/ccs/auth.ts", {
    ...baseDependencies(),
    "@/lib/auth": {
      getJwtSecretKey: () => secret,
      verifyAuth: async () => ({ userId: "admin", contestId: 1001, loginSource: "PROCTORING", proctoringKeyHash: originalHash }),
    },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ contestId: 1001, role: "ADMIN", proctoringKeyHash: storedHash }) },
      contest: { findUnique: async () => privateContest },
    } },
  });
  const request = (proof?: string) => new NextRequest("https://example.test/api/ccs/contests/1001/event-feed", {
    headers: { cookie: `user_token=proctor-session; contest_access_1001=${grant}`, ...(proof ? { [proctoring.PROCTORING_HEADER]: proof } : {}) },
  });
  const missingProof = await ccs.createCCSAuthValidator(request());
  assert.equal(await missingProof?.(), false);
  const validate = await ccs.createCCSAuthValidator(request(key));
  assert.equal(await validate?.(), true);
  storedHash = proctoring.proctoringKeyHash(crypto.randomBytes(32).toString("base64url"));
  assert.equal(await validate?.(), false);
});

test("contest and problem archives reject revoked administrator sessions before accessing protected storage", async () => {
  for (const filename of [
    "app/api/contests/import/route.ts", "app/api/contests/export/route.ts",
    "app/api/problems/import/route.ts", "app/api/problems/export/route.ts",
  ]) {
    for (const globalUser of [null, { isGlobalAdmin: false }]) {
      let checks = 0;
      let effects = 0;
      const blocked = new Proxy(() => { effects++; throw new Error("Storage access before current administrator check"); }, { get: () => blocked });
      const route = loadModule<Route>(filename, {
        ...baseDependencies(), path, fs: { promises: blocked },
        "next/headers": { cookies: async () => ({ get: () => ({ value: "old-admin-token" }) }) },
        "@/lib/auth": {
          getVerifiedGlobalUser: async () => { checks++; return globalUser; },
          verifyAuth: async () => ({ isGlobalAdmin: true }),
        },
        "@/lib/prisma": { prisma: blocked },
      });
      const response = await route.POST(new Request("https://example.test/", { method: "POST" }));
      assert.equal(response.status, 403, filename);
      assert.equal(checks, 1, filename);
      assert.equal(effects, 0, filename);
    }
  }
});

test("a captured CCS stream validator revokes contest-admin access after the password changes", async () => {
  let contest = { ...privateContest };
  const token = await tokens.signContestAccessToken(contest, secret);
  const ccs = loadModule<{ createCCSAuthValidator(req: NextRequest): Promise<(() => Promise<boolean>) | null> }>("lib/ccs/auth.ts", {
    ...baseDependencies(),
    "@/lib/auth": { getJwtSecretKey: () => secret, verifyAuth: async () => ({ userId: "admin", contestId: 1001 }) },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => ({ contestId: 1001, role: "ADMIN" }) },
      contest: { findUnique: async () => contest },
    } },
  });
  const request = (grant = "") => new NextRequest("https://example.test/api/ccs/contests/1001/event-feed", {
    headers: { cookie: `user_token=admin-session; contest_access_1001=${grant}` },
  });
  const missing = await ccs.createCCSAuthValidator(request());
  assert.equal(await missing?.(), false);
  const validate = await ccs.createCCSAuthValidator(request(token));
  assert.equal(await validate?.(), true);
  contest = { ...contest, password: "changed" };
  assert.equal(await validate?.(), false);
});

test("an open submission stream stops before reading new progress after password revocation", async () => {
  let contest = { ...privateContest };
  const token = await tokens.signContestAccessToken(contest, secret);
  let poll: (() => Promise<void>) | undefined;
  let progressReads = 0;
  const route = loadModule<Route>("app/api/submission/[id]/stream/route.ts", {
    ...baseDependencies(),
    "@/lib/auth": { getCurrentSuper: async () => null, getJwtSecretKey: () => secret },
    "@/lib/contest-access": { contestAccessResponse: async () => null },
    "@/lib/generated/prisma/enums": { Verdict: { JUDGING: "JUDGING", PENDING: "PENDING" } },
    "@/lib/prisma": { prisma: { submission: { findUnique: async ({ select }: { select: Record<string, unknown> }) =>
      select.contestId ? { contestId: 1001 } : { contest, verdict: "JUDGING", passedTests: 0, totalTests: 2 },
    } } },
    "@/lib/redis": { redis: { get: async () => { progressReads++; return null; } } },
    "@/lib/submission-visibility": { canViewSubmissionTestDetails: async () => true },
  }, {
    setInterval: (callback: () => Promise<void>) => { poll = callback; return 1; },
    clearInterval: () => {},
  });
  const response = await route.GET(new NextRequest("https://example.test/api/submission/id/stream", {
    headers: { cookie: `contest_access_1001=${token}` },
  }), { params: Promise.resolve({ id: "id" }) });
  const reader = response.body!.getReader();
  const initial = await reader.read();
  assert.equal(initial.done, false);
  const event = new TextDecoder().decode(initial.value);
  assert.match(event, /JUDGING/);
  assert.equal(event.includes(privateContest.password), false);
  assert.equal(event.includes("contest"), false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(poll);
  contest = { ...contest, password: "changed" };
  await poll();
  assert.equal((await reader.read()).done, true);
  assert.equal(progressReads, 1);
});
