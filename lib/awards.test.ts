import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { FeedAward } from "./awards";
import { Verdict } from "./generated/prisma/enums";
import * as medalUtils from "./medal-utils";

const startTime = new Date("2026-10-25T01:00:00Z");
const problems = [
  { problemId: 17, displayId: "A" },
  { problemId: 42, displayId: "B" },
  { problemId: 99, displayId: "C" },
  { problemId: 108, displayId: "D" },
];
const solves = [
  { problemId: 17, username: "team-main", minute: 10 },
  { problemId: 42, username: "team-main", minute: 20 },
  { problemId: 42, username: "team-star", minute: 30 },
  { problemId: 99, username: "team-star", minute: 40 },
];

async function feedAwards(options: {
  solves?: typeof solves;
  enabled?: boolean;
  firstToSolve?: boolean;
} = {}): Promise<FeedAward[]> {
  const submissions = (options.solves ?? solves).map((solve) => ({
    problemId: solve.problemId,
    verdict: Verdict.ACCEPTED,
    submittedAt: new Date(startTime.getTime() + solve.minute * 60_000),
    user: { username: solve.username },
  })).sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const dependencies: Record<string, unknown> = {
    "./medal-utils": medalUtils,
    "./generated/prisma/enums": { Verdict },
    "./prisma": { prisma: {
      contest: { findUnique: async () => ({
        startTime,
        endTime: new Date(startTime.getTime() + 5 * 60 * 60_000),
        config: { awards: {
          enabled: options.enabled ?? true,
          firstToSolve: options.firstToSolve ?? true,
        } },
      }) },
      contestProblem: { findMany: async () => problems },
      submission: { findMany: async () => submissions },
      user: { findMany: async () => ["team-main", "team-star"].map((username) => ({
        username,
        displayName: null,
        school: null,
        category: username === "team-star" ? "1" : null,
        submissions: submissions.filter((s) => s.user.username === username),
      })) },
    } },
  };
  const filename = "lib/awards.ts";
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected awards dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  const awards = await (exports as {
    getFeedAwards(contestId: number): Promise<FeedAward[]>;
  }).getFeedAwards(1);
  return JSON.parse(JSON.stringify(awards));
}

test("first-to-solve awards keep one record per solved problem, including repeated and starred winners", async () => {
  assert.deepEqual(await feedAwards(), [
    { id: "first-to-solve-17", citation: "First to solve problem A", team_ids: ["team-main"] },
    { id: "first-to-solve-42", citation: "First to solve problem B", team_ids: ["team-main"] },
    { id: "first-to-solve-99", citation: "First to solve problem C", team_ids: ["team-star"] },
  ]);
});

test("first-to-solve IDs stay tied to problems when winners and standings change", async () => {
  const before = await feedAwards();
  const after = await feedAwards({ solves: [
    { problemId: 17, username: "team-star", minute: 5 },
    ...solves,
  ] });
  assert.deepEqual(after.map((award) => award.id), before.map((award) => award.id));
  assert.deepEqual(after[0], {
    id: "first-to-solve-17",
    citation: "First to solve problem A",
    team_ids: ["team-star"],
  });
  assert.deepEqual(after.slice(1), before.slice(1));
});

test("disabled first-to-solve awards and unsolved problems produce no award records", async () => {
  for (const options of [{ enabled: false }, { firstToSolve: false }, { solves: [] }]) {
    assert.deepEqual(await feedAwards(options), []);
  }
});
