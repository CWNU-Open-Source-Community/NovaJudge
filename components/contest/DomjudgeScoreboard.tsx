import "@/app/(main)/contest/domjudge-scoreboard.css";
import type { ContestConfig } from "@/app/(main)/page";
import { prisma } from "@/lib/prisma";
import { getOrganizationDirectory } from "@/lib/org-mapper";
import { getContestTeamStandings, setTeamRanks } from "@/lib/contest-team-standings";
import {
  boardFilters, boardTeamDetails, boardTeamInfo, canViewBoardRuns, matchesBoardFilters, scoreboardCell, scoreboardClock, summarizeBoard,
  type BoardContest, type BoardQuery,
} from "@/lib/domjudge-scoreboard";
import DomjudgeRefresh from "./DomjudgeRefresh";
import DomjudgeBoardFilter from "./DomjudgeBoardFilter";
import DomjudgeBoardTable from "./DomjudgeBoardTable";
import { CountryFlag } from "./DomjudgeScoreBadges";

const clockTime = new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" });
const updateTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

async function ContestAffiliations({ contestId }: { contestId: number }) {
  const [teams, organizations] = await Promise.all([
    prisma.user.findMany({
      where: { contestId, role: "TEAM", school: { not: null } },
      distinct: ["category", "school"], select: { school: true, category: true },
      orderBy: [{ category: "asc" }, { school: "asc" }],
    }),
    getOrganizationDirectory(),
  ]);
  const groups = new Map<string, ReturnType<typeof boardTeamInfo>[]>();
  for (const team of teams) {
    const info = boardTeamInfo(team, organizations);
    const label = info.categoryName || "Teams";
    const group = groups.get(label) ?? [];
    if (!group.some(affiliation => affiliation.affiliationName === info.affiliationName)) group.push(info);
    groups.set(label, group);
  }
  return <div className="dj-affiliation-groups">{Array.from(groups, ([label, affiliations]) =>
    <section key={label}><h2>{label}</h2><ul>{affiliations.map(({ affiliationName, country, countryName }) =>
      <li key={affiliationName}><CountryFlag country={country} countryName={countryName} />{affiliationName}</li>
    )}</ul></section>
  )}</div>;
}

async function Standings({ contest, now, clock, viewerId, query }: {
  contest: BoardContest; now: Date; clock: ReturnType<typeof scoreboardClock>; viewerId: string; query: BoardQuery;
}) {
  const [{ rankings, problems }, organizations] = await Promise.all([
    getContestTeamStandings(contest, { visibleUntil: now, freezeAt: clock.freezeAt, maskFrozenVerdicts: true, includeCoach: true }),
    getOrganizationDirectory(),
  ]);
  const teams = rankings.map(team => ({ team, info: boardTeamInfo(team, organizations) }));
  const filters = boardFilters(teams.map(({ info }) => info), query);
  const visible = teams.filter(({ info }) => matchesBoardFilters(info, filters));
  const ranked = visible.map(({ team }) => team);
  setTeamRanks(ranked);
  const medalConfig = (contest.config as ContestConfig | null)?.medal;
  const medalsEnabled = !!medalConfig && (medalConfig.gold > 0 || medalConfig.silver > 0 || medalConfig.bronze > 0);
  // Project only displayed scores. Submission IDs, judgements and source never enter the table payload.
  const rows = visible.map(({ team, info }) => ({
    ...boardTeamDetails(team, info),
    rank: team.rank, solved: team.solved, penalty: team.penalty, medal: team.medal,
    canViewRuns: canViewBoardRuns(clock, viewerId, team.id), cells: team.problems.map(scoreboardCell),
  }));
  return <>
    <DomjudgeBoardFilter base={`/contest/${contest.id}/rank`} filters={filters} />
    <DomjudgeBoardTable contestId={contest.id} rows={rows} problems={problems} totals={summarizeBoard(rows, problems.length)}
      viewerId={viewerId} updatedAt={now.getTime()} medalsEnabled={medalsEnabled} />
  </>;
}

export default function DomjudgeScoreboard({ contest, viewerId, query }: {
  contest: BoardContest; viewerId: string; query: BoardQuery;
}) {
  const now = new Date();
  const clock = scoreboardClock(contest, now);
  const { started, ended, frozen, minutes } = clock;
  let status = `started: ${clockTime.format(contest.startTime)} - ends: ${clockTime.format(contest.endTime)}`;
  if (!started) status = `starts: ${contest.startTime.toLocaleString("en-GB")}`;
  else if (ended) status = frozen ? "contest over, waiting for results" : "final standings";
  return <section className="dj-standings" lang="en" aria-label="Scoreboard">
    <DomjudgeRefresh />
    <header className="dj-board-banner"><h1>{contest.title}</h1><span>{status}</span></header>
    {frozen && <p className="dj-freeze-notice" role="status">
      The scoreboard was frozen with {minutes} minutes remaining - solutions submitted in the last {minutes} minutes of the contest are still shown as pending.
    </p>}
    {started ? <Standings contest={contest} now={now} clock={clock} viewerId={viewerId} query={query} /> :
      <ContestAffiliations contestId={contest.id} />}
    <p className="dj-board-updated">Last Update: <time dateTime={now.toISOString()}>{updateTime.format(now)}</time><br />
      using <a href="https://www.domjudge.org/">DOMjudge</a></p>
  </section>;
}
