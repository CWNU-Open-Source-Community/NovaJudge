import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { contestSampleArchive } from "./contest-sample-archive";
import { problemSubmissionStats } from "./domjudge-problem-stats";
import type { Verdict } from "./generated/prisma/enums";

test("individual and contest ZIPs contain the published sample bytes, including only the public communication rounds", async () => {
  const a = { displayId: "A", problemId: 1, problem: { type: "default", samples: [{ input: " 1\r\n", output: "2\n" }] } };
  const b = { displayId: "B", problemId: 2, problem: { type: "communication", samples: [{
    input: "first\n", output: "private judge answer", communication: { firstOutput: "message", secondInput: "second", secondOutput: "" },
  }] } };
  const single = await JSZip.loadAsync((await contestSampleArchive([a], false))!);
  assert.deepEqual(Object.keys(single.files), ["1.in", "1.ans"]);
  assert.equal(await single.file("1.in")!.async("text"), " 1\r\n");
  const contest = await JSZip.loadAsync((await contestSampleArchive([a, b, { ...a, displayId: "a", problemId: 3 }], true))!);
  const files = Object.values(contest.files).filter(file => !file.dir);
  assert.deepEqual(files.map(file => file.name), ["A/1.in", "A/1.ans", "B/1.in", "B/1.ans", "B/2.in", "B/2.ans", "problem~3/1.in", "problem~3/1.ans"]);
  assert.deepEqual(await Promise.all(files.slice(2, 6).map(file => file.async("text"))), ["first\n", "message", "second", ""]);
  assert.equal(await contestSampleArchive([{ ...a, problem: { type: "default", samples: [] } }], false), null);
});

test("the problemset shows judged attempts by interval and only the combined total throughout a frozen interval", () => {
  const run = (minute: number, verdict: Verdict) => ({ problemId: 1, submittedAt: new Date(minute * 60000), verdict });
  const stats = problemSubmissionStats([1, 2], [
    run(0, "WRONG_ANSWER"), run(15, "ACCEPTED"), run(16, "JUDGING"), run(237, "ACCEPTED"),
    run(240, "PENDING"), run(299, "WRONG_ANSWER"), run(301, "WRONG_ANSWER"),
  ], 0, 300 * 60000, 238 * 60000);
  const bins = stats.byProblem.get(1)!;
  assert.equal(bins.length, 20);
  assert.deepEqual(bins.slice(0, 2).map(b => [b.correct, b.incorrect, b.frozen]), [[0, 1, false], [1, 0, false]]);
  for (const index of [15, 16, 19]) assert.deepEqual([bins[index].correct, bins[index].incorrect, bins[index].frozen], [1, 1, true]);
  assert.ok(stats.byProblem.get(2)!.every(b => b.correct === 0 && b.incorrect === 0));
});
