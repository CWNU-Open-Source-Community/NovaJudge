import assert from "node:assert/strict";
import test from "node:test";
import { Verdict } from "@/lib/generated/prisma/enums";
import { summarizeRankProblems } from "./rank-problem-stats";

function submission(
  time: number,
  verdict: Verdict,
  problemId = 11,
  participant: { globalUserId?: string; virtualParticipationId?: string } = {},
) {
  return {
    problemId,
    verdict,
    submittedAt: new Date(time),
    globalUserId: participant.globalUserId ?? null,
    virtualParticipationId: participant.virtualParticipationId ?? null,
  };
}

test("problem totals count all submissions and count each team once per problem", () => {
  const teams = [
    { submissions: [
      submission(10, Verdict.WRONG_ANSWER),
      submission(20, Verdict.ACCEPTED),
      submission(30, Verdict.ACCEPTED),
      submission(40, Verdict.COMPILE_ERROR, 12),
    ] },
    { submissions: [
      submission(12, Verdict.WRONG_ANSWER),
      submission(14, Verdict.PENDING),
      submission(50, Verdict.ACCEPTED, 99),
    ] },
  ];
  assert.deepEqual(summarizeRankProblems([11, 12, 13], teams, { start: 10, end: 50 }), [
    { problemId: 11, submitted: 5, attempted: 2, accepted: 1 },
    { problemId: 12, submitted: 1, attempted: 1, accepted: 0 },
    { problemId: 13, submitted: 0, attempted: 0, accepted: 0 },
  ]);
});

test("totals only use the visible contest window, with an exclusive freeze boundary", () => {
  const teams = [{ submissions: [
    submission(9, Verdict.WRONG_ANSWER),
    submission(10, Verdict.WRONG_ANSWER),
    submission(20, Verdict.ACCEPTED, 11, { virtualParticipationId: "vp" }),
    submission(21, Verdict.ACCEPTED, 11, { globalUserId: "account" }),
    submission(30, Verdict.ACCEPTED),
    submission(50, Verdict.WRONG_ANSWER),
    submission(60, Verdict.ACCEPTED),
  ] }];
  const bounds = { start: 10, end: 50 };

  assert.deepEqual(summarizeRankProblems([11], teams, { ...bounds, freezeAt: 30 }), [
    { problemId: 11, submitted: 1, attempted: 1, accepted: 0 },
  ]);
  assert.deepEqual(summarizeRankProblems([11], teams, { ...bounds, end: 29 }), [
    { problemId: 11, submitted: 1, attempted: 1, accepted: 0 },
  ]);
  assert.deepEqual(summarizeRankProblems([11], teams, bounds), [
    { problemId: 11, submitted: 3, attempted: 1, accepted: 1 },
  ]);
});
