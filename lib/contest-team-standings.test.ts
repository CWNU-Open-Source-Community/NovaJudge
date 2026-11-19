import assert from "node:assert/strict";
import test from "node:test";
import type { Verdict } from "./generated/prisma/enums";
import { assignTeamMedals, rankContestTeams, scoreContestTeam, scoreboardFreezeTime } from "./contest-team-standings";
import { scoreboardCell } from "./domjudge-scoreboard";

const minute = 60_000;
const contest = { id: 10, startTime: new Date(0), endTime: new Date(100 * minute) };
const problems = [{ problemId: 1, displayId: "A", color: null }, { problemId: 2, displayId: "B", color: null }];
function run(id: number, minutes: number, verdict: Verdict, problemId = 1) {
  return { id: String(id), displayId: id, submittedAt: new Date(minutes * minute), verdict, problemId };
}
function team(id: string, submissions: ReturnType<typeof run>[], category = "0") {
  return { id, username: id, members: null, displayName: null, school: null, category, submissions };
}

test("the team summary and standings count attempts up to the first AC and rank official ties together", () => {
  const teams = [
    team("star", [run(1, 5, "ACCEPTED")], "1"),
    team("home", [run(2, 1, "COMPILE_ERROR"), run(3, 2, "WRONG_ANSWER"), run(4, 10, "ACCEPTED"), run(5, 11, "WRONG_ANSWER")]),
    team("tied", [run(6, 30, "ACCEPTED")]),
    team("next", [run(7, 31, "ACCEPTED"), run(8, 101, "ACCEPTED", 2)]),
  ];
  const { rankings } = rankContestTeams(teams, problems, contest, +contest.endTime, Infinity, false);
  assert.deepEqual(rankings.map(r => [r.rank, r.solved, r.penalty]), [["*", 1, 5], [1, 1, 30], [1, 1, 30], [3, 1, 31]]);
  assert.equal(rankings[0].problems[0]?.firstBlood, true);
  assert.equal(rankings[1].problems[0]?.firstBlood, false);
  assert.equal(rankings[1].problems[0]?.tries, 1);
  assert.equal(rankings[1].problems[1], null);
  assert.equal(rankings[3].problems[1]?.upsolved, false);
  assert.equal(rankContestTeams(teams, problems, contest, +contest.endTime, Infinity, true).rankings[3].problems[1]?.upsolved, true);
});

test("an AC exactly at the freeze boundary stays pending until unfreeze", () => {
  const teams = [team("home", [run(1, 79, "WRONG_ANSWER"), run(2, 80, "ACCEPTED"), run(3, 90, "SYSTEM_ERROR")])];
  const calculate = (freezeAt: number) => rankContestTeams(teams, problems, contest, +contest.endTime, freezeAt, false).rankings[0];
  const frozen = calculate(scoreboardFreezeTime(contest.endTime, 20));
  const quota = { mode: "fixed", gold: 1 } as const;
  assignTeamMedals([frozen], quota);
  assert.equal(frozen.medal, "");
  assert.equal(frozen.solved, 0);
  assert.equal(frozen.penalty, 0);
  assert.equal(frozen.problems[0]?.firstBlood, false);
  assert.equal(frozen.problems[0]?.frozenTries, 1);
  assert.equal(frozen.problems[0]?.unfrozenTries, 1);
  assert.equal(frozen.problems[0]?.firstAcceptedSubmissionId, undefined);
  const live = calculate(scoreboardFreezeTime(contest.endTime, 0));
  assignTeamMedals([live], quota);
  assert.equal(live.medal, "Gold");
  assert.equal(live.solved, 1);
  assert.equal(live.penalty, 100);
  assert.equal(live.problems[0]?.time, "80");
});

test("the private score counts the team's judged runs during the freeze and keeps published first solves", () => {
  const tasks = [...problems, { problemId: 3, displayId: "C", color: null }, { problemId: 4, displayId: "D", color: null }];
  const publishedFirst = run(2, 8, "ACCEPTED");
  const runs = [
    run(1, -1, "ACCEPTED", 2), publishedFirst, run(3, 70, "WRONG_ANSWER", 2),
    run(4, 80, "COMPILE_ERROR", 2), run(5, 80, "TIME_LIMIT_EXCEEDED", 2), run(6, 80, "ACCEPTED", 2),
    run(7, 85, "RUNTIME_ERROR", 3), run(8, 88, "JUDGING", 4),
    run(9, 96, "ACCEPTED", 3), run(10, 101, "ACCEPTED", 4),
  ];
  const firstSolves = new Map([[1, publishedFirst]]);
  const personal = scoreContestTeam(runs, tasks, contest, { end: 95 * minute, firstSolves });
  assert.equal(personal.solved, 2);
  assert.equal(personal.penalty, 128);
  assert.deepEqual(personal.problems.map(scoreboardCell).map(c => [c?.state, c?.minute, c?.judged, c?.pending]), [
    ["first", 8, 1, 0], ["correct", 80, 3, 0], ["incorrect", null, 1, 0], ["pending", null, 0, 1],
  ]);
  const atContestEnd = scoreContestTeam(runs, tasks, contest, { end: +contest.endTime, firstSolves });
  assert.equal(atContestEnd.solved, 3);
  assert.equal(atContestEnd.problems[3]?.accepted, false);
});

test("an unjudged run before an accepted submission is pending and incurs no wrong-answer penalty", () => {
  const teams = [team("home", [run(1, 2, "PENDING"), run(2, 4, "WRONG_ANSWER"), run(3, 8, "ACCEPTED")])];
  const row = rankContestTeams(teams, problems, contest, +contest.endTime, Infinity, false).rankings[0];
  assert.equal(row.penalty, 28);
  assert.equal(row.problems[0]?.pendingTries, 1);
});

test("teams with only failed attempts, no submissions or only upsolves leave medals vacant", () => {
  const teams = [
    team("wrong", [run(1, 5, "WRONG_ANSWER")]),
    team("empty", []),
    team("practice", [run(2, 101, "ACCEPTED")]),
    team("star", [run(3, 10, "ACCEPTED")], "1"),
  ];
  const { rankings } = rankContestTeams(teams, problems, contest, +contest.endTime, Infinity, true);
  assignTeamMedals(rankings, { mode: "fixed", gold: 1, silver: 1, bronze: 1 });
  assert.ok(rankings.every(row => row.medal === ""));
});

test("ratio quotas count all official teams, award only visible solves and clear superseded medals", () => {
  const teams = [
    team("star", [run(1, 3, "ACCEPTED")], "1"),
    team("first", [run(2, 10, "ACCEPTED")]),
    team("second", [run(3, 20, "ACCEPTED")], "2"),
    team("third", [run(4, 30, "ACCEPTED")]),
    team("last", [run(5, 40, "ACCEPTED")]),
    team("empty", []),
  ];
  const { rankings } = rankContestTeams(teams, problems, contest, +contest.endTime, Infinity, false);
  assignTeamMedals(rankings, { mode: "ratio", gold: 25, silver: 20, bronze: 20 });
  assert.deepEqual(rankings.map(row => row.medal), ["", "Gold", "Gold", "Silver", "Bronze", ""]);
  assignTeamMedals(rankings, { mode: "fixed", silver: 1 });
  assert.deepEqual(rankings.map(row => row.medal), ["", "Silver", "", "", "", ""]);
});

test("a medal boundary within a tie gives the same recipients across independent standings queries", () => {
  const teams = [team("a", [run(1, 10, "ACCEPTED")]), team("b", [run(2, 10, "ACCEPTED")])];
  for (const input of [teams, [...teams].reverse()]) {
    const { rankings } = rankContestTeams(input, problems, contest, +contest.endTime, Infinity, false);
    assignTeamMedals(rankings, { mode: "fixed", gold: 1 });
    assert.deepEqual(rankings.map(row => [row.username, row.rank, row.medal]), [["a", 1, "Gold"], ["b", 1, ""]]);
  }
});
