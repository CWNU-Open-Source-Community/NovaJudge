import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { Verdict } from "./generated/prisma/enums";
import * as rejudgeTypes from "./contest-rejudge-types";
import type * as Auth from "./contest-management-auth";
import type * as Query from "./contest-submission-query";
import type * as Rejudge from "./contest-rejudge";

function load<T>(filename: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    Error,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return exports as T;
}

test("contest management uses the current database role, contest membership and private access", async () => {
  for (const scenario of [
    { role: "ADMIN", contestId: 7, allowed: true, expected: true },
    { role: "JUDGE", contestId: 7, allowed: true, expected: true },
    { role: "TEAM", contestId: 7, allowed: true, expected: false },
    { role: "ADMIN", contestId: 8, allowed: true, expected: false },
    { role: "ADMIN", contestId: 7, allowed: false, expected: false },
  ]) {
    const auth = load<typeof Auth>("lib/contest-management-auth.ts", {
      "next/headers": { cookies: async () => ({ get: () => ({ value: "token" }) }) },
      "./auth": { getCurrentSuper: async () => null, verifyAuth: async () => ({ userId: "manager", role: "ADMIN", contestId: 7 }) },
      "./contest-access": { hasContestAccess: async () => scenario.allowed },
      "./prisma": { prisma: { user: { findUnique: async () => ({ id: "manager", ...scenario }) } } },
    });
    assert.equal(Boolean(await auth.getContestManager(7)), scenario.expected, JSON.stringify(scenario));
    if (!scenario.expected) await assert.rejects(auth.requireContestManager(7));
  }
  const auth = load<typeof Auth>("lib/contest-management-auth.ts", {
    "next/headers": { cookies: () => assert.fail("A verified global administrator needs no contest login") },
    "./auth": { getCurrentSuper: async () => ({ userId: "super", isGlobalAdmin: true }) },
    "./contest-access": { hasContestAccess: async () => true },
    "./prisma": { prisma: {} },
  });
  assert.equal((await auth.requireContestManager(7)).key, "global-super");
});

type Row = {
  id: string;
  contestId: number;
  displayId: number;
  problemId: number;
  verdict: string;
  language: string;
  submittedAt: Date;
  timeUsed: number | null;
  memoryUsed: number | null;
  errorMessage: string | null;
  passedTests: number;
  totalTests: number;
  user: { displayName: string; username: string; school: string; seat: string };
};

function row(id: string, verdict: string = Verdict.WRONG_ANSWER, contestId = 7): Row {
  return {
    id, contestId, displayId: 123, problemId: 42, verdict,
    language: "cpp", submittedAt: new Date("2026-10-25T03:00:00Z"),
    timeUsed: 25, memoryUsed: 1024, errorMessage: "previous", passedTests: 2, totalTests: 8,
    user: { displayName: "星火队", username: "team023", school: "某大学", seat: "B12" },
  };
}

type Where = Record<string, unknown>;
function matches(value: unknown, where: unknown): boolean {
  if (!where || typeof where !== "object") return value === where;
  const object = value as Record<string, unknown>;
  return Object.entries(where as Where).every(([key, expected]) => {
    if (key === "AND") return (expected as unknown[]).every((condition) => matches(value, condition));
    if (key === "OR") return (expected as unknown[]).some((condition) => matches(value, condition));
    if (key === "in") return (expected as unknown[]).includes(value);
    if (key === "notIn") return !(expected as unknown[]).includes(value);
    if (key === "contains") return typeof value === "string" && value.toLowerCase().includes(String(expected).toLowerCase());
    if (key === "mode") return true;
    if (key === "gte") return new Date(value as string) >= new Date(expected as string);
    if (key === "lte") return new Date(value as string) <= new Date(expected as string);
    return object != null && matches(object[key], expected);
  });
}

function harness() {
  const rows = [row("wa"), row("ac", Verdict.ACCEPTED), row("busy", Verdict.JUDGING), row("other", Verdict.WRONG_ANSWER, 8)];
  const storage = new Map<string, string>();
  const jobs = new Map<string, string>();
  const writes: string[] = [];
  const enqueued: string[] = [];
  const state = {
    actor: "judge-a", authorized: true, failEnqueue: false, workerStartsBeforeFailure: false,
    workerFinishesBeforeFailure: false, finishesWhileReadingProgress: false,
  };
  const prisma = {
    contestProblem: {
      findFirst: async ({ where }: { where: Where }) => where.contestId === 7 && where.displayId === "B" ? { problemId: 42 } : null,
      findMany: async () => [{ problemId: 42, displayId: "B" }],
    },
    submission: {
      findMany: async ({ where, take }: { where: Where; take?: number }) => rows.filter((value) => matches(value, where)).slice(0, take).map((value) => ({ ...value })),
      findFirst: async ({ where, select }: { where: Where; select: Record<string, boolean> }) => {
        const found = rows.find((value) => matches(value, where));
        return found ? Object.fromEntries(Object.keys(select).map((key) => [key, found[key as keyof Row]])) : null;
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const matching = rows.filter((value) => matches(value, where));
        matching.forEach((value) => { writes.push(value.id); Object.assign(value, data); });
        return { count: matching.length };
      },
    },
  };
  const query = load<typeof Query>("lib/contest-submission-query.ts", {
    "./generated/prisma/enums": { Verdict }, "./prisma": { prisma },
  });
  const service = load<typeof Rejudge>("lib/contest-rejudge.ts", {
    "node:crypto": { randomUUID },
    "./generated/prisma/enums": { Verdict },
    "./contest-rejudge-types": rejudgeTypes,
    "./contest-submission-query": query,
    "./contest-management-auth": { requireContestManager: async () => {
      if (!state.authorized) throw new Error("Unauthorized");
      return { key: state.actor };
    } },
    "./prisma": { prisma },
    "./redis": { redis: {
      set: async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes("NX") && storage.has(key)) return null;
        storage.set(key, value);
        return "OK";
      },
      eval: async (_script: string, _count: number, key: string, owner?: string) => {
        const value = storage.get(key);
        if (owner !== undefined) {
          if (value === owner) storage.delete(key);
          return 1;
        }
        storage.delete(key);
        return value ?? null;
      },
    } },
    "./queue": {
      judgeQueue: { getJob: async (key: string) => jobs.has(key) ? { getState: async () => {
        if (state.finishesWhileReadingProgress) {
          const submission = rows.find((value) => `judge-sub-${value.id}` === key);
          if (submission) submission.verdict = Verdict.ACCEPTED;
          return "completed";
        }
        return jobs.get(key);
      } } : undefined },
      enqueueJudge: async (id: string) => {
        if (state.failEnqueue) {
          if (state.workerStartsBeforeFailure) rows.find((value) => value.id === id)!.verdict = Verdict.JUDGING;
          if (state.workerFinishesBeforeFailure) {
            rows.find((value) => value.id === id)!.verdict = Verdict.ACCEPTED;
            jobs.set(`judge-sub-${id}`, "completed");
          }
          throw new Error("Queue unavailable");
        }
        enqueued.push(id);
        jobs.set(`judge-sub-${id}`, "waiting");
      },
    },
  });
  return { ...service, query, rows, storage, jobs, writes, enqueued, state };
}

test("the shared query supports team names and exact run IDs without broadening invalid filters", async () => {
  const { query, rows } = harness();
  for (const userSearch of ["星火", "TEAM023", "某大学", "B12"]) {
    const where = await query.buildContestSubmissionWhere(7, { userSearch, problem: "B", runId: "123" });
    assert.equal(rows.filter((value) => matches(value, where)).length, 3);
    assert.equal(matches(rows[3], where), false);
  }
  for (const filters of [
    { problem: "not-a-contest-problem" }, { runId: "123junk" }, { verdict: "TYPO" },
    { from: "2026-10-25T10:00" },
    { from: "2026-10-25T12:00:00+08:00", to: "2026-10-25T11:00:00+08:00" },
  ]) await assert.rejects(query.buildContestSubmissionWhere(7, filters));
});

test("preview fixes the candidate list and cannot be consumed by a different actor or contest", async () => {
  const h = harness();
  const preview = await h.previewRejudge(7, { filters: { problem: "B", userSearch: "星火" } });
  assert.equal(preview.count, 1);
  assert.equal(preview.sample?.[0].problemLabel, "B");
  h.rows.push(row("new-after-preview"));
  h.state.actor = "judge-b";
  assert.ok((await h.executeRejudge(7, preview.token!)).error);
  h.state.actor = "judge-a";
  assert.ok((await h.executeRejudge(8, preview.token!)).error);
  const result = await h.executeRejudge(7, preview.token!);
  assert.equal(result.queued, 1);
  assert.deepEqual(h.enqueued, ["wa"]);
  assert.equal(h.rows.find((value) => value.id === "new-after-preview")?.verdict, Verdict.WRONG_ANSWER);
  assert.ok((await h.executeRejudge(7, preview.token!)).error);
});

test("execution rechecks verdicts and contest scope, and AC requires explicit inclusion", async () => {
  const h = harness();
  assert.equal((await h.previewRejudge(7, { filters: {}, submissionIds: ["other", "ac", "busy"] })).count, 0);
  assert.ok((await h.previewRejudge(7, { filters: {}, submissionIds: [] })).error);
  const preview = await h.previewRejudge(7, { filters: {}, submissionIds: ["wa"] });
  h.rows[0].verdict = Verdict.ACCEPTED;
  const result = await h.executeRejudge(7, preview.token!);
  assert.equal(result.skipped, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(await h.requeueSubmission("ac", { contestId: 7 }), "skipped");
  assert.equal(await h.requeueSubmission("other", { contestId: 7, includeAccepted: true }), "skipped");
  assert.equal(await h.requeueSubmission("ac", { contestId: 7, includeAccepted: true }), "queued");
});

test("active jobs and concurrent rejudge requests cannot reset or duplicate a submission", async () => {
  const h = harness();
  h.jobs.set("judge-sub-wa", "active");
  assert.equal(await h.requeueSubmission("wa", { contestId: 7 }), "skipped");
  assert.equal(h.writes.length, 0);
  h.jobs.set("judge-sub-wa", "completed");
  const outcomes = await Promise.all([h.requeueSubmission("wa", { contestId: 7 }), h.requeueSubmission("wa", { contestId: 7 })]);
  assert.deepEqual(outcomes.sort(), ["queued", "skipped"]);
  assert.deepEqual(h.enqueued, ["wa"]);
});

test("queue failure restores the previous result without overwriting a running worker", async () => {
  const h = harness();
  h.state.failEnqueue = true;
  const original = { ...h.rows[0] };
  assert.equal(await h.requeueSubmission("wa", { contestId: 7 }), "failed");
  assert.deepEqual(h.rows[0], original);
  assert.equal(h.storage.size, 0);
  h.state.workerStartsBeforeFailure = true;
  assert.equal(await h.requeueSubmission("wa", { contestId: 7 }), "failed");
  assert.equal(h.rows[0].verdict, Verdict.JUDGING);
});

test("all endpoints reauthorize before reading candidates, snapshots, or progress", async () => {
  const h = harness();
  const preview = await h.previewRejudge(7, { filters: {} });
  h.state.authorized = false;
  assert.match((await h.previewRejudge(7, { filters: {} })).error!, /Unauthorized/);
  assert.match((await h.executeRejudge(7, preview.token!)).error!, /Unauthorized/);
  assert.match((await h.readRejudgeProgress(7, ["wa"])).error!, /Unauthorized/);
  assert.equal(h.writes.length, 0);
  h.state.authorized = true;
  assert.equal((await h.executeRejudge(7, preview.token!)).queued, 1);
});

test("a lost enqueue response does not report failure after the new job already completed", async () => {
  const h = harness();
  h.state.failEnqueue = true;
  h.state.workerFinishesBeforeFailure = true;
  assert.equal(await h.requeueSubmission("wa", { contestId: 7 }), "queued");
  assert.equal(h.rows[0].verdict, Verdict.ACCEPTED);
});

test("progress distinguishes queued, running, completed and failed jobs within the contest", async () => {
  const h = harness();
  h.rows[0].verdict = Verdict.PENDING;
  h.jobs.set("judge-sub-wa", "waiting");
  h.jobs.set("judge-sub-busy", "active");
  h.rows.push(row("system-error", Verdict.SYSTEM_ERROR));
  h.rows.push(row("broken-job", Verdict.PENDING));
  h.jobs.set("judge-sub-broken-job", "failed");
  const result = await h.readRejudgeProgress(7, ["wa", "busy", "ac", "system-error", "broken-job"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { pending: 1, judging: 1, completed: 1, failed: 2 });
  assert.ok((await h.readRejudgeProgress(7, ["other"])).error);
});

test("progress rechecks a verdict when the job completes after the database snapshot", async () => {
  const h = harness();
  h.rows[0].verdict = Verdict.PENDING;
  h.jobs.set("judge-sub-wa", "waiting");
  h.state.finishesWhileReadingProgress = true;
  const result = await h.readRejudgeProgress(7, ["wa"]);
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 0);
  h.state.finishesWhileReadingProgress = false;
  h.rows[0].verdict = Verdict.PENDING;
  h.jobs.set("judge-sub-wa", "completed");
  assert.equal((await h.readRejudgeProgress(7, ["wa"])).failed, 1);
});
