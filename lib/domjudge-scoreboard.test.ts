import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationMap } from "./org-mapper";
import { boardFilters, boardTeamDetails, boardTeamInfo, matchesBoardFilters, scoreboardCell, scoreboardClock, summarizeBoard } from "./domjudge-scoreboard";
import type { TeamRankData } from "./contest-team-standings";
import { Verdict } from "./generated/prisma/enums";
import { domjudgeResult, scoreboardVerdict } from "./domjudge-verdict";

const result: NonNullable<TeamRankData["problems"][number]> = {
  problemId: 1, displayId: "A", color: null, firstBlood: false, accepted: false, time: "", tries: 0,
  pendingTries: 0, frozenTries: 0, unfrozenTries: 0, upsolved: false,
};

test("live scoreboard verdicts group all judged failures and distinguish them again after release", () => {
  for (const verdict of Object.values(Verdict)) {
    if (verdict === "PENDING" || verdict === "JUDGING") {
      assert.equal(scoreboardVerdict(verdict, false), "pending");
      assert.equal(scoreboardVerdict(verdict, true), "pending");
    } else {
      assert.equal(scoreboardVerdict(verdict, false), verdict === "ACCEPTED" ? "correct" : "rejected");
      assert.equal(scoreboardVerdict(verdict, true), domjudgeResult[verdict]);
    }
  }
});

test("DOMjudge cells and the summary count each queued or frozen attempt exactly once", () => {
  const accepted = scoreboardCell({ ...result, accepted: true, firstBlood: true, time: "0", firstAcceptedSubmissionId: 123 });
  const pending = scoreboardCell({ ...result, tries: 4, pendingTries: 1, frozenTries: 13 });
  assert.deepEqual(accepted, { state: "first", minute: 0, judged: 1, pending: 0, attempts: "1 try" });
  assert.deepEqual(pending, { state: "pending", minute: null, judged: 3, pending: 14, attempts: "3 + 14 tries" });
  assert.equal(scoreboardCell({ ...result, frozenTries: 1 })?.attempts, "0 + 1 tries");
  assert.equal(scoreboardCell({ ...result, tries: 1 })?.state, "incorrect");
  assert.equal(scoreboardCell(result), null);
  assert.equal(scoreboardCell(null), null);
  assert.deepEqual(summarizeBoard([{ cells: [accepted, null] }, { cells: [pending, null] }], 2), [
    { accepted: 1, rejected: 3, pending: 14, first: 0 }, { accepted: 0, rejected: 0, pending: 0, first: null },
  ]);
});

test("DOMjudge filters combine affiliations, countries and categories, including legacy and missing organizations", () => {
  const orgs = parseOrganizationMap('{"School A":{"id":"2343","country":"gb"},"School B":{"id":"7","country":"DK"},"School C":"legacy"}');
  const rows = [["School A", "0"], ["School A", "2"], ["School B", "2"], ["School C", "0"], ["School D", "0"]]
    .map(([school, category]) => boardTeamInfo({ school, category }, orgs));
  assert.deepEqual(rows.map(team => [team.affiliationId, team.country]), [
    ["2343", "GB"], ["2343", "GB"], ["7", "DK"], ["legacy", ""], ["", ""],
  ]);
  const groups = boardFilters(rows, { countries: ["GB", "DK"], categories: "2", affiliations: "2343" });
  assert.deepEqual(groups.map(group => group.key), ["affiliations", "countries", "categories"]);
  assert.deepEqual(rows.filter(team => matchesBoardFilters(team, groups)), [rows[1]]);
  assert.deepEqual(boardFilters([rows[0]], {}), []);
  assert.throws(() => parseOrganizationMap('{"School":{"id":"x","country":"123"}}'));
});

test("team details show the registered coach and matched logo with the team's registered school name", () => {
  const info = boardTeamInfo({ school: "North", category: "2" }, {
    North: { id: "org-7", name: "North University", logoHash: "school-logo" },
  });
  const team = { id: "1", displayName: "Night Owls", username: "team-01", members: "A, B", coach: "  Lin  " };
  assert.deepEqual(boardTeamDetails(team, info), {
    id: "1", name: "Night Owls", members: "A, B", coach: "Lin", school: "North", logoHash: "school-logo",
    country: "", countryName: "", category: "2", categoryName: "Women",
  });
  const missing = boardTeamDetails({ ...team, displayName: null, coach: " " }, boardTeamInfo({ school: "New School", category: null }, {}));
  assert.equal(missing.name, team.username);
  assert.equal(missing.coach, null);
  assert.equal(missing.logoHash, undefined);
});

test("the DOMjudge freeze starts at its boundary, survives contest end and ends on release", () => {
  const contest = { id: 1, title: "Contest", startTime: new Date(0), endTime: new Date(300 * 60_000), status: "RUNNING" as const, config: { frozenDuration: 60 } };
  assert.equal(scoreboardClock(contest, new Date(240 * 60_000 - 1)).frozen, false);
  assert.equal(scoreboardClock(contest, new Date(240 * 60_000)).frozen, true);
  assert.deepEqual(scoreboardClock(contest, contest.endTime), { started: true, ended: true, frozen: true, released: false, freezeAt: 240 * 60_000, minutes: 60 });
  const unfrozen = { ...contest, config: { frozenDuration: 0 } };
  assert.equal(scoreboardClock(unfrozen, new Date(+contest.endTime - 1)).released, false);
  assert.equal(scoreboardClock(unfrozen, contest.endTime).released, true);
  assert.equal(scoreboardClock(unfrozen, contest.endTime).freezeAt, Infinity);
  assert.equal(scoreboardClock({ ...contest, status: "PENDING" }, contest.endTime).started, false);
});
