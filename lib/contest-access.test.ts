import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as tokens from "./contest-access-token";

type Contest = { id: number; type: string; password: string | null };
type Access = {
  getContestAccess(id: number): Promise<{ contest: Contest | null; allowed: boolean }>;
  hasContestAccess(id: number): Promise<boolean>;
  requireContestAccess(id: number): Promise<void>;
  contestAccessResponse(id: number): Promise<Response | null>;
};
type Route = {
  GET(request: Request, context: { params: Promise<Record<string, string>> }): Promise<Response>;
};
type CookieOptions = { httpOnly: boolean; sameSite: string; path: string; maxAge: number; secure: boolean };
const secret = new TextEncoder().encode("contest-access-handler-regression-secret");
const privateContest: Contest = { id: 1001, type: "PRIVATE", password: "private password" };

function loadModule<T>(filename: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => dependencies[name] ?? {},
    process: { cwd: () => process.cwd(), env: { NODE_ENV: "production", ENABLE_SECURE_COOKIE: "true" } },
    console: { error() {}, log() {} },
    Response,
    TextEncoder,
    ReadableStream,
    setInterval,
    clearInterval,
  }, { filename });
  return exports as T;
}

function harness(options: {
  contest?: Contest | null;
  user?: { isGlobalAdmin: boolean } | null;
  cookies?: Record<string, string>;
} = {}) {
  let contest = options.contest === undefined ? { ...privateContest } : options.contest;
  const cookieValues = new Map(Object.entries(options.cookies ?? {}));
  const writtenCookies: { name: string; value: string; options: CookieOptions }[] = [];
  const cookieStore = {
    get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
    set: (name: string, value: string, flags: CookieOptions) => {
      cookieValues.set(name, value);
      writtenCookies.push({ name, value, options: flags });
    },
  };
  const dependencies = {
    react: { cache: <T>(fn: T) => fn },
    "next/headers": { cookies: async () => cookieStore },
    "next/navigation": {
      redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
      notFound: () => { throw new Error("NOT_FOUND"); },
    },
    "next/server": { NextResponse },
    "@/lib/auth": { getCurrentSuper: async () => options.user ?? null, getJwtSecretKey: () => secret },
    "@/lib/prisma": { prisma: { contest: { findUnique: async ({ where }: { where: { id: number } }) => contest?.id === where.id ? contest : null } } },
    "@/lib/contest-access-token": tokens,
  };
  const access = loadModule<Access>("lib/contest-access.ts", dependencies);
  return {
    access,
    dependencies: { ...dependencies, "@/lib/contest-access": access },
    writtenCookies,
    setContest(next: Contest) { contest = next; },
  };
}

test("public contests remain accessible while all ordinary sessions need a private grant", async () => {
  assert.equal(await harness({ contest: { ...privateContest, type: "PUBLIC" } }).access.hasContestAccess(1001), true);
  for (const options of [
    {},
    { user: { isGlobalAdmin: false } },
    { cookies: { user_token: "existing-team-session", auth_token: "existing-global-session" } },
    { contest: { ...privateContest, password: null } },
  ]) {
    assert.equal(await harness(options).access.hasContestAccess(1001), false);
  }
  assert.equal(await harness({ user: { isGlobalAdmin: true } }).access.hasContestAccess(1001), true);
});

test("the access helper checks the current password and rejects cross-contest and malformed grants", async () => {
  const token = await tokens.signContestAccessToken(privateContest, secret);
  const h = harness({ cookies: { contest_access_1001: token } });
  assert.equal(await h.access.hasContestAccess(1001), true);
  h.setContest({ ...privateContest, password: "rotated" });
  assert.equal(await h.access.hasContestAccess(1001), false);
  h.setContest({ ...privateContest, password: null });
  assert.equal(await h.access.hasContestAccess(1001), false);
  const other = await tokens.signContestAccessToken({ ...privateContest, id: 1002 }, secret);
  for (const value of [other, "invalid.jwt.token"]) {
    assert.equal(await harness({ cookies: { contest_access_1001: value } }).access.hasContestAccess(1001), false);
  }
});

test("page and API gates deny before exposing contest contents", async () => {
  const h = harness();
  await assert.rejects(h.access.requireContestAccess(1001), /REDIRECT:\/contest\/1001\/access/);
  const denied = await h.access.contestAccessResponse(1001);
  assert.equal(denied?.status, 403);
  assert.equal(denied?.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await denied?.json(), { error: "请先输入比赛密码", code: "CONTEST_PASSWORD_REQUIRED" });
  await assert.rejects(h.access.requireContestAccess(2000), /NOT_FOUND/);
  assert.equal((await h.access.contestAccessResponse(2000))?.status, 404);
  for (const id of [0, -1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await h.access.contestAccessResponse(id))?.status, 400);
  }
  assert.equal(await harness({ user: { isGlobalAdmin: true } }).access.contestAccessResponse(1001), null);
});

function unlock(h: ReturnType<typeof harness>) {
  return loadModule<{
    unlockContest(id: number, previous: { error: string }, data: FormData): Promise<{ error: string }>;
  }>("app/(main)/contest/[contestId]/access/actions.ts", h.dependencies).unlockContest;
}

test("unlocking rejects incorrect, missing, and unconfigured passwords without writing a cookie", async () => {
  for (const password of ["wrong", "", `${privateContest.password} `]) {
    const h = harness();
    const data = new FormData();
    data.set("password", password);
    assert.match((await unlock(h)(1001, { error: "" }, data)).error, /密码错误/);
    assert.equal(h.writtenCookies.length, 0);
  }
  const noPassword = harness({ contest: { ...privateContest, password: null } });
  assert.match((await unlock(noPassword)(1001, { error: "" }, new FormData())).error, /尚未配置/);
  assert.equal(noPassword.writtenCookies.length, 0);
  const missing = harness({ contest: null });
  assert.match((await unlock(missing)(1001, { error: "" }, new FormData())).error, /不存在/);
});

test("a correct password issues a scoped signed HttpOnly cookie and unlocks the contest", async () => {
  const h = harness();
  const data = new FormData();
  data.set("password", privateContest.password!);
  await assert.rejects(unlock(h)(1001, { error: "" }, data), /REDIRECT:\/contest\/1001$/);
  assert.equal(h.writtenCookies.length, 1);
  const cookie = h.writtenCookies[0];
  assert.equal(cookie.name, "contest_access_1001");
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, "lax");
  assert.equal(cookie.options.path, "/");
  assert.equal(cookie.options.secure, true);
  assert.equal(cookie.options.maxAge, tokens.CONTEST_ACCESS_MAX_AGE);
  assert.equal(await tokens.verifyContestAccessToken(cookie.value, privateContest, secret), true);
  assert.equal(await h.access.hasContestAccess(1001), true);
});

test("direct problem and notice APIs reject guests before loading private contents", async () => {
  for (const filename of [
    "app/api/contests/[contestId]/latest-notice/route.ts",
    "app/api/contests/[contestId]/problems/route.ts",
  ]) {
    const h = harness();
    let contentReads = 0;
    const blockedRead = async () => { contentReads++; throw new Error("Content read before authorization"); };
    const route = loadModule<Route>(filename, {
      ...h.dependencies,
      "@/lib/prisma": { prisma: { clarification: { findFirst: blockedRead }, contestProblem: { findMany: blockedRead } } },
      "@/lib/generated/prisma/enums": { ClariCategory: { NOTICE: "NOTICE" } },
    });
    const response = await route.GET(new Request("https://example.test/"), { params: Promise.resolve({ contestId: "1001" }) });
    assert.equal(response.status, 403, filename);
    assert.equal(contentReads, 0, filename);
  }
});

test("private submission polling and streams deny guessed IDs before Redis or verdict reads", async () => {
  for (const filename of [
    "app/api/submission/[id]/route.ts",
    "app/api/submission/[id]/stream/route.ts",
  ]) {
    const h = harness();
    let protectedReads = 0;
    const blockedRead = async () => { protectedReads++; throw new Error("Progress read before authorization"); };
    const route = loadModule<Route>(filename, {
      ...h.dependencies,
      "@/lib/prisma": { prisma: { submission: { findUnique: async ({ select }: { select: Record<string, boolean> }) => {
        if (Object.keys(select).join() !== "contestId") return blockedRead();
        return { contestId: 1001 };
      } } } },
      "@/lib/redis": { redis: { get: blockedRead } },
      "@/lib/submission-visibility": { canViewSubmissionTestDetails: blockedRead },
    });
    const response = await route.GET(new Request("https://example.test/"), { params: Promise.resolve({ id: "known-submission-id" }) });
    assert.equal(response.status, 403, filename);
    assert.equal(protectedReads, 0, filename);
  }
});

test("private-only problem assets require a grant and never receive public cache headers", async () => {
  const token = await tokens.signContestAccessToken(privateContest, secret);
  for (const allowed of [false, true]) {
    const h = harness({ cookies: allowed ? { contest_access_1001: token } : {} });
    let fileReads = 0;
    const route = loadModule<Route>("app/api/problems/[id]/assets/[filename]/route.ts", {
      ...h.dependencies,
      "@/lib/prisma": { prisma: { contestProblem: { findMany: async () => [{ contestId: 1001, contest: { type: "PRIVATE" } }] } } },
      "fs/promises": { readFile: async () => { fileReads++; return Buffer.from("private figure"); } },
      path,
      mime: { getType: () => "image/png" },
    });
    const response = await route.GET(new Request("https://example.test/"), { params: Promise.resolve({ id: "7", filename: "figure.png" }) });
    assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(fileReads, allowed ? 1 : 0);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(await response.text(), allowed ? "private figure" : "Forbidden");
  }
});
