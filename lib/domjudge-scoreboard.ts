import type { Contest } from "./generated/prisma/client";
import type { TeamRankData } from "./contest-team-standings";
import { matchOrganization, type OrganizationMap } from "./organizations";
import { scoreboardFreezeTime } from "./contest-team-standings";
import { attemptsLabel } from "./problem-badge";

export type BoardContest = Pick<Contest, "id" | "title" | "startTime" | "endTime" | "status" | "config">;

export function elapsedContestTime(start: Date, submittedAt: Date) {
  const minutes = Math.floor((+submittedAt - +start) / 60_000);
  return minutes < 0 ? "Before contest" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function scoreboardClock(contest: BoardContest, now: Date) {
  const minutes = Number((contest.config as { frozenDuration?: number } | null)?.frozenDuration ?? 0);
  const started = contest.status !== "PENDING" && now >= contest.startTime;
  const ended = contest.status === "ENDED" || now >= contest.endTime;
  const freezeTime = scoreboardFreezeTime(contest.endTime, minutes);
  const frozen = started && +now >= freezeTime;
  return { started, ended, frozen, released: started && ended && !frozen, freezeAt: frozen ? freezeTime : Infinity, minutes };
}

export function canViewBoardRuns(clock: ReturnType<typeof scoreboardClock>, viewerId: string, teamId: string) {
  return clock.started && (viewerId === teamId || clock.released);
}

export type BoardCell = {
  state: "first" | "correct" | "incorrect" | "pending";
  minute: number | null;
  judged: number;
  pending: number;
  attempts: string;
};

export function scoreboardCell(result: TeamRankData["problems"][number]): BoardCell | null {
  if (!result) return null;
  const queued = result.pendingTries ?? 0;
  const judged = result.tries - queued + Number(result.accepted);
  const pending = queued + result.frozenTries;
  if (!judged && !pending) return null;
  return {
    state: result.accepted ? (result.firstBlood ? "first" : "correct") : (pending ? "pending" : "incorrect"),
    minute: result.accepted ? Number(result.time) : null,
    judged, pending, attempts: pending ? `${judged} + ${pending} tries` : attemptsLabel(judged),
  };
}

export function summarizeBoard(rows: { cells: (BoardCell | null)[] }[], problemCount: number) {
  const totals = Array.from({ length: problemCount }, () => ({
    accepted: 0, rejected: 0, pending: 0, first: null as number | null,
  }));
  for (const { cells } of rows) {
    cells.forEach((cell, index) => {
      if (!cell) return;
      const total = totals[index];
      if (cell.minute !== null) {
        total.accepted++;
        total.first = Math.min(total.first ?? cell.minute, cell.minute);
      }
      total.rejected += cell.judged - Number(cell.minute !== null);
      total.pending += cell.pending;
    });
  }
  return totals;
}

const categoryNames = new Map([["0", "Official"], ["1", "Unofficial"], ["2", "Women"]]);
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export function boardTeamInfo(team: Pick<TeamRankData, "school" | "category">, organizations: OrganizationMap) {
  const affiliation = matchOrganization(organizations, team.school);
  const country = affiliation?.country ?? "";
  return {
    school: team.school?.trim() ?? "", affiliationId: affiliation?.id ?? "",
    affiliationName: affiliation?.name || team.school?.trim() || "", logoHash: affiliation?.logoHash,
    country, countryName: country ? countryNames.of(country) ?? country : "",
    category: team.category ?? "", categoryName: team.category ? categoryNames.get(team.category) ?? team.category : "",
  };
}

export function boardTeamDetails(
  team: Pick<TeamRankData, "id" | "username" | "displayName" | "members" | "coach">,
  { school, logoHash, country, countryName, category, categoryName }: ReturnType<typeof boardTeamInfo>,
) {
  return {
    id: team.id, name: team.displayName || team.username, members: team.members, coach: team.coach?.trim() || null,
    school, logoHash, country, countryName, category, categoryName,
  };
}

export type BoardTeamDetails = ReturnType<typeof boardTeamDetails>;
export type BoardTeam = BoardTeamDetails & {
  rank: number | string; medal?: TeamRankData["medal"];
  solved: number; penalty: number; canViewRuns: boolean; cells: (BoardCell | null)[];
};

export type FilterKey = "affiliations" | "countries" | "categories";
export type BoardQuery = Partial<Record<FilterKey, string | string[]>>;
export type BoardFilter = {
  key: FilterKey; label: string; options: { value: string; name: string }[]; selected: string[];
};
type TeamInfo = ReturnType<typeof boardTeamInfo>;

function filterValues(team: TeamInfo, key: FilterKey): [string, string] {
  if (key === "countries") return [team.country, team.countryName];
  if (key === "categories") return [team.category, team.categoryName];
  return [team.affiliationId || team.affiliationName, team.affiliationName];
}

export function boardFilters(teams: TeamInfo[], query: BoardQuery): BoardFilter[] {
  const keys: FilterKey[] = ["affiliations", "countries", "categories"];
  return keys.flatMap(key => {
    const values = new Map(teams.map(team => filterValues(team, key)));
    values.delete("");
    if (values.size < 2) return [];
    const param = query[key];
    const selected = Array.isArray(param) ? param : param ? [param] : [];
    const options = Array.from(values, ([value, name]) => ({ value, name })).sort((a, b) => a.name.localeCompare(b.name, "en"));
    return [{ key, label: key[0].toUpperCase() + key.slice(1), options, selected: selected.filter(value => values.has(value)) }];
  });
}

export function matchesBoardFilters(team: TeamInfo, filters: BoardFilter[]) {
  return filters.every(({ key, selected }) => !selected.length || selected.includes(filterValues(team, key)[0]));
}
