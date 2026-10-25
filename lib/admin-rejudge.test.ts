import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { Verdict } from "./generated/prisma/enums";
import type { RejudgeFilters } from "../app/admin/submissions/actions";

function harness() {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/admin-auth": { requireSuperAdmin: async () => ({ isGlobalAdmin: true }) },
    "@/lib/prisma": { prisma: { submission: {
      findMany: async (query: { where: Record<string, unknown> }) => { queries.push(query); return []; },
      count: async (query: { where: Record<string, unknown> }) => { queries.push(query); return 0; },
    } } },
    "@/lib/generated/prisma/enums": { Verdict },
    "next/cache": { revalidatePath() {} },
    "@/lib/queue": {},
  };
  const filename = "app/admin/submissions/actions.ts";
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => dependencies[name] ?? {},
  }, { filename });
  return {
    queries,
    actions: exports as {
      getGlobalSubmissions(page: number, size: number, problem: string, team: string): Promise<unknown>;
      countRejudgeCandidates(filters: RejudgeFilters): Promise<{ count?: number; error?: string }>;
    },
  };
}

test("global submissions and batch rejudge both search team names, accounts, schools and seats", async () => {
  const { actions, queries } = harness();
  await actions.getGlobalSubmissions(1, 15, "Graph", "星火");
  await actions.countRejudgeCandidates({ contestId: 17, username: "星火" });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries[0].where, queries[1].where);
  for (const query of queries) {
    const search = query.where.OR as Array<{ user?: { OR: Array<Record<string, { contains: string }>> } }>;
    const teamFields = search[0].user!.OR;
    assert.deepEqual(Array.from(teamFields, (field) => Object.keys(field)[0]), ["username", "displayName", "school", "seat"]);
    for (const field of teamFields) assert.equal(Object.values(field)[0].contains, "星火");
  }
  assert.ok(queries[0].where.problem, "Problem filtering must remain combined with team filtering");
  assert.equal(queries[2].where.contestId, 17);
});

test("explicit verdict filters cannot bypass the AC toggle or include submissions still being judged", async () => {
  const { actions, queries } = harness();
  for (const verdict of [Verdict.ACCEPTED, Verdict.PENDING, Verdict.JUDGING]) {
    await actions.countRejudgeCandidates({ verdict });
    const filter = queries.at(-1)!.where.verdict as { equals: string; notIn: string[] };
    assert.equal(filter.equals, verdict);
    assert.ok(filter.notIn.includes(verdict));
  }
  await actions.countRejudgeCandidates({ verdict: Verdict.ACCEPTED, includeAccepted: true });
  const filter = queries.at(-1)!.where.verdict as { notIn: string[] };
  assert.ok(!filter.notIn.includes(Verdict.ACCEPTED));
  assert.ok(filter.notIn.includes(Verdict.PENDING));
  assert.ok(filter.notIn.includes(Verdict.JUDGING));
});

test("invalid batch scope and time filters fail without issuing a broad query", async () => {
  const { actions, queries } = harness();
  for (const filters of [
    { contestId: 0 }, { problemId: -1 }, { verdict: "NOT_A_VERDICT" },
    { from: "bad-date" }, { from: "2026-10-25T12:00:00Z", to: "2026-10-25T11:00:00Z" },
  ]) {
    assert.ok((await actions.countRejudgeCandidates(filters)).error);
  }
  assert.equal(queries.length, 0);
});
