import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as tokens from "./contest-access-token";
import { canViewBoardRuns, elapsedContestTime, scoreboardClock } from "./domjudge-scoreboard";
import { scoreboardVerdict } from "./domjudge-verdict";
import { getOfficialSubmissionWhere } from "./official-submission";

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
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
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
    setTimeout,
    clearTimeout,
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

test("a saved DOMjudge preference only applies to the verified team's own contest", async () => {
  const cases = [
    { team: null, preference: "domjudge", enabled: false }, // guest or an active global session
    { team: { role: "JUDGE", contestId: 1001 }, preference: "domjudge", enabled: false },
    { team: { role: "TEAM", contestId: 1002 }, preference: "domjudge", enabled: false },
    { team: { role: "TEAM", contestId: 1001 }, preference: undefined, enabled: false },
    { team: { role: "TEAM", contestId: 1001 }, preference: "domjudge", enabled: true },
  ];
  for (const { team, preference, enabled } of cases) {
    const { usesDomjudge } = loadModule<{ usesDomjudge(id: number): Promise<boolean> }>(
      "lib/contest-interface.ts", {
        react: { cache: <T>(fn: T) => fn },
        "./auth": { getCurrentUser: async () => team },
        "next/headers": { cookies: async () => ({ get: () => ({ value: preference }) }) },
      },
    );
    assert.equal(await usesDomjudge(1001), enabled);
  }
});

test("DOMjudge teams can read only their own cell histories until the final standings are released", async () => {
  const start = Date.now() - 270 * 60_000;
  const at = (minutes: number) => new Date(start + minutes * 60_000);
  const contest = { id: 1001, title: "Contest", startTime: at(0), endTime: at(300), status: "RUNNING", config: { frozenDuration: 0 } };
  let viewer: { contestId: number; userId: string; domjudge: boolean } | null = { contestId: 1001, userId: "home", domjudge: true };
  let allowed = true;
  let reads = 0;
  const { getBoardRuns } = loadModule<typeof import("../app/(main)/contest/[contestId]/(board)/rank/domjudge-actions")>(
    "app/(main)/contest/[contestId]/(board)/rank/domjudge-actions.ts", {
      "@/lib/contest-interface": { getTeamInterface: async () => viewer },
      "@/lib/contest-access": { getContestAccess: async () => ({ allowed }) },
      "@/lib/domjudge-scoreboard": { canViewBoardRuns, elapsedContestTime, scoreboardClock },
      "@/lib/official-submission": { getOfficialSubmissionWhere },
      "@/lib/contest-languages": { contestLanguages: [{ value: "cpp", label: "C++" }] },
      "@/lib/domjudge-verdict": { scoreboardVerdict },
      "@/lib/prisma": { prisma: {
        contest: { findUnique: async () => contest },
        submission: { findMany: async ({ where, select }: { where: ReturnType<typeof getOfficialSubmissionWhere>; select: Record<string, boolean> }) => {
          reads++;
          assert.equal(where.contestId, 1001);
          assert.equal(where.globalUserId, null);
          assert.equal(where.virtualParticipationId, null);
          assert.equal(where.problemId, 2);
          assert.equal(where.user?.is?.contestId, 1001);
          assert.equal(where.user?.is?.role, "TEAM");
          assert.deepEqual(Object.keys(select).sort(), ["displayId", "language", "submittedAt", "verdict"]);
          return [
            { displayId: 20, language: "cpp", verdict: "JUDGING", submittedAt: at(241) },
            { displayId: 19, language: "cpp", verdict: "ACCEPTED", submittedAt: at(240) },
            { displayId: 18, language: "cpp", verdict: "TIME_LIMIT_EXCEEDED", submittedAt: at(238) },
          ];
        } },
      } },
    },
  );
  assert.equal(await getBoardRuns(1002, "home", 2), null);
  assert.equal(reads, 0);
  const history = async (team: string) => Array.from(await getBoardRuns(1001, team, 2) ?? [], run =>
    [run.time, run.language, run.result, run.detailId]);
  const expectDenied = async (team: string) => {
    const before = reads;
    assert.equal(await getBoardRuns(1001, team, 2), null);
    assert.equal(reads, before);
  };
  await expectDenied("other");
  assert.deepEqual(await history("home"), [
    ["4:01", "C++", "pending", 20], ["4:00", "C++", "correct", 19], ["3:58", "C++", "rejected", 18],
  ]);
  contest.config.frozenDuration = 60;
  await expectDenied("other");
  assert.deepEqual(await history("home"), [
    ["4:01", "C++", "pending", null], ["4:00", "C++", "pending", null], ["3:58", "C++", "rejected", 18],
  ]);
  contest.status = "ENDED";
  await expectDenied("other");
  contest.config.frozenDuration = 0;
  assert.deepEqual(await history("other"), [
    ["4:01", "C++", "pending", 20], ["4:00", "C++", "correct", 19], ["3:58", "C++", "timelimit", 18],
  ]);
  allowed = false;
  await expectDenied("home");
  allowed = true;
  contest.status = "PENDING";
  await expectDenied("home");
  await expectDenied("other");
  contest.status = "RUNNING";
  viewer.domjudge = false;
  await expectDenied("home");
  viewer = null;
  await expectDenied("home");
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
    unlockContest(id: number, previous: { error: string | null }, data: FormData): Promise<{ error: string }>;
  }>("app/(main)/contest/[contestId]/access/actions.ts", h.dependencies).unlockContest;
}

test("a DOMjudge upload from a stale team tab cannot submit as a global user", async () => {
  let queued = false;
  const { submitTeamFile } = loadModule<{
    submitTeamFile(id: number, problem: string, language: string, code: string): Promise<{ error: string }>;
  }>("app/(main)/contest/[contestId]/(board)/submit/actions.ts", {
    "@/lib/contest-access": { requireContestAccess: async () => {} },
    "@/lib/auth": {
      getCurrentSuper: async () => ({ userId: "global", isGlobalAdmin: false }),
      getCurrentUser: async () => ({ userId: "old-team", role: "TEAM", contestId: 1001 }),
    },
    "@/lib/contest-submission": { createContestSubmission: async () => { queued = true; } },
  });
  assert.equal((await submitTeamFile(1001, "A", "cpp", "int main() {}")).error, "teamRequired");
  assert.equal(queued, false);
});

test("editor submissions return to the active interface's submissions view only after a successful save", async () => {
  const { dependencies } = harness({ contest: { ...privateContest, type: "PUBLIC" } });
  let domjudge = true;
  let frozen = false;
  let saved = 0;
  const revalidated: string[] = [];
  class FrozenSubmissionError extends Error { readonly code = "frozen"; }
  const { submitCode } = loadModule<typeof import("../app/(main)/contest/[contestId]/(board)/submit/actions")>(
    "app/(main)/contest/[contestId]/(board)/submit/actions.ts", {
      ...dependencies,
      "@/lib/auth": {
        getCurrentSuper: async () => null,
        getCurrentUser: async () => ({ userId: "team", role: "TEAM", contestId: 1001 }),
      },
      "@/lib/contest-interface": { usesDomjudge: async () => domjudge },
      "@/lib/generated/prisma/client": { ContestRole: { TEAM: "TEAM" } },
      "@/lib/contest-submission": {
        ContestSubmissionError: FrozenSubmissionError,
        createContestSubmission: async () => { if (frozen) throw new FrozenSubmissionError(); saved++; },
      },
      "next/cache": { revalidatePath: (url: string) => revalidated.push(url) },
    },
  );
  const submit = () => submitCode(1001, "A", "cpp", "int main() {}");
  await assert.rejects(submit(), /REDIRECT:\/contest\/1001$/);
  domjudge = false;
  await assert.rejects(submit(), /REDIRECT:\/contest\/1001\/status$/);
  domjudge = true;
  frozen = true;
  assert.equal((await submit()).error, "frozen");
  assert.equal(saved, 2);
  assert.deepEqual(revalidated, ["/contest/1001"]);
});

test("opening a filtered status list in DOMjudge returns to Home after the contest access check", async () => {
  for (const type of ["PUBLIC", "PRIVATE"]) {
    const { dependencies } = harness({ contest: { ...privateContest, type } });
    const { default: Status } = loadModule<typeof import("../app/(main)/contest/[contestId]/(board)/status/page")>(
      "app/(main)/contest/[contestId]/(board)/status/page.tsx", {
        ...dependencies,
        "@/lib/contest-interface": { usesDomjudge: async () => true },
      },
    );
    const page = Status({
      params: Promise.resolve({ contestId: "1001" }),
      searchParams: Promise.resolve({ problem: "A", viewAll: "true" }),
    });
    await assert.rejects(page, type === "PUBLIC" ? /REDIRECT:\/contest\/1001$/ : /REDIRECT:\/contest\/1001\/access$/);
  }
});

test("unlocking rejects incorrect, missing, and unconfigured passwords without writing a cookie", async () => {
  for (const password of ["wrong", "", `${privateContest.password} `]) {
    const h = harness();
    const data = new FormData();
    data.set("password", password);
    assert.equal((await unlock(h)(1001, { error: null }, data)).error, "wrongPassword");
    assert.equal(h.writtenCookies.length, 0);
  }
  const noPassword = harness({ contest: { ...privateContest, password: null } });
  assert.equal((await unlock(noPassword)(1001, { error: null }, new FormData())).error, "unconfigured");
  assert.equal(noPassword.writtenCookies.length, 0);
  const missing = harness({ contest: null });
  assert.equal((await unlock(missing)(1001, { error: null }, new FormData())).error, "notFound");
});

test("a correct password issues a scoped signed HttpOnly cookie and unlocks the contest", async () => {
  const h = harness();
  const data = new FormData();
  data.set("password", privateContest.password!);
  await assert.rejects(unlock(h)(1001, { error: null }, data), /REDIRECT:\/contest\/1001$/);
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

test("a team source archive only reads submissions belonging to its verified contest account", async () => {
  const h = harness({ contest: { ...privateContest, type: "PUBLIC" } });
  for (const viewer of [null, { userId: "team", role: "TEAM", contestId: 1002 },
    { userId: "judge", role: "JUDGE", contestId: 1001 }, { userId: "team", role: "TEAM", contestId: 1001 }]) {
    let reads = 0;
    const route = loadModule<Route>("app/api/contests/[contestId]/submissions/[id]/source/route.ts", {
      ...h.dependencies,
      "@/lib/auth": { getCurrentUser: async () => viewer },
      "@/lib/prisma": { prisma: { submission: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        reads++;
        assert.deepEqual({ ...where }, { id: "other-run", contestId: 1001, userId: "team", globalUserId: null, virtualParticipationId: null });
        return null;
      } } } },
    });
    const allowed = viewer?.contestId === 1001 && viewer.role === "TEAM";
    const response = await route.GET(new Request("https://example.test"), { params: Promise.resolve({ contestId: "1001", id: "other-run" }) });
    assert.equal(response.status, allowed ? 404 : 403);
    assert.equal(reads, Number(allowed));
  }
});

test("leaving a live verdict while a database read is in flight cancels the next poll", async () => {
  let reads = 0;
  let resolveRead!: (result: { verdict: string; passedTests: number; totalTests: number }) => void;
  const inFlight = new Promise(resolve => { resolveRead = resolve; });
  const route = loadModule<Route>("app/api/submission/[id]/stream/route.ts", {
    "@/lib/auth": { getCurrentSuper: async () => null },
    "@/lib/prisma": { prisma: { submission: { findUnique: async () => ++reads === 1 ? { contestId: null } : inFlight } } },
    "@/lib/submission-visibility": { canViewSubmissionTestDetails: async () => true },
    "@/lib/generated/prisma/enums": { Verdict: { PENDING: "PENDING", JUDGING: "JUDGING" } },
  });
  const response = await route.GET(new Request("https://example.test"), { params: Promise.resolve({ id: "run" }) });
  await response.body!.cancel();
  resolveRead({ verdict: "PENDING", passedTests: 0, totalTests: 0 });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(reads, 2);
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
