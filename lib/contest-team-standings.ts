import { prisma } from "./prisma";
import type { Contest, Submission, User } from "./generated/prisma/client";
import { compareTeamScores, getMedalists, type ContestMedalConfig } from "./medal-utils";

type ContestClock = Pick<Contest, "id" | "startTime" | "endTime">;
type Run = Pick<Submission, "id" | "displayId" | "problemId" | "verdict" | "submittedAt">;
type Team = Pick<User, "id" | "username" | "displayName" | "members" | "school" | "category"> & Partial<Pick<User, "coach">>;
export type StandingsProblem = { problemId: number; displayId: string; color: string | null };
type ProblemResult = StandingsProblem & {
  firstBlood: boolean;
  accepted: boolean;
  time: string;
  tries: number;
  frozenTries: number;
  pendingTries?: number;
  unfrozenTries: number;
  firstAcceptedSubmissionId?: number;
  upsolved: boolean;
};

export interface TeamRankData extends Team {
  rank: number | string;
  medal?: "Gold" | "Silver" | "Bronze" | "";
  contestUserId?: string;
  isVirtual?: boolean;
  solved: number;
  penalty: number;
  problems: Array<ProblemResult | null>;
}

export function scoreboardFreezeTime(endTime: Date, frozenMinutes: number) {
  return frozenMinutes > 0 ? endTime.getTime() - frozenMinutes * 60_000 : Infinity;
}

export async function getContestTeamStandings(
  contest: ContestClock & Pick<Contest, "config">,
  { visibleUntil = contest.endTime, freezeAt = Infinity, includeUpsolving = false, maskFrozenVerdicts = false, includeCoach = false } = {},
) {
  const end = Math.min(visibleUntil.getTime(), contest.endTime.getTime());
  const [teams, contestProblems] = await Promise.all([
    prisma.user.findMany({
      where: { contestId: contest.id, role: "TEAM" },
      select: {
        id: true, username: true, displayName: true, members: true, school: true, category: true, coach: includeCoach,
        submissions: {
          where: {
            contestId: contest.id, globalUserId: null, virtualParticipationId: null,
            submittedAt: { gte: contest.startTime, lte: includeUpsolving ? undefined : new Date(end) },
          },
          select: {
            id: true, displayId: true, problemId: true, verdict: true, submittedAt: true,
            globalUserId: true, virtualParticipationId: true,
          },
          orderBy: [{ submittedAt: "asc" }, { displayId: "asc" }],
        },
      },
    }),
    prisma.contestProblem.findMany({
      where: { contestId: contest.id }, orderBy: { displayId: "asc" },
      select: { problemId: true, displayId: true, color: true, problem: { select: { title: true } } },
    }),
  ]);
  const problems = contestProblems.map(({ problem, ...entry }) => ({ ...entry, title: problem.title }));
  if (maskFrozenVerdicts && Number.isFinite(freezeAt)) {
    // Even compiler errors count as pending on the DOMjudge public board during the freeze.
    for (const team of teams) {
      for (const run of team.submissions) if (+run.submittedAt >= freezeAt) run.verdict = "PENDING";
    }
  }
  const standings = rankContestTeams(teams, problems, contest, end, freezeAt, includeUpsolving);
  const config = contest.config as { medal?: ContestMedalConfig } | null;
  assignTeamMedals(standings.rankings, config?.medal);
  return { teams, problems, ...standings };
}

// Submissions arrive in contest-time order, with the run number breaking timestamp ties.
export function rankContestTeams(
  teams: (Team & { submissions: Run[] })[], problems: StandingsProblem[], contest: ContestClock,
  end: number, freezeAt: number, includeUpsolving: boolean,
) {
  const firstSolves = new Map<number, Run>();
  for (const team of teams) {
    for (const run of team.submissions) {
      if (run.verdict !== "ACCEPTED" || run.submittedAt.getTime() > end) continue;
      const first = firstSolves.get(run.problemId);
      if (!first || run.submittedAt < first.submittedAt ||
          (+run.submittedAt === +first.submittedAt && run.displayId < first.displayId)) {
        firstSolves.set(run.problemId, run);
      }
    }
  }

  const rankings: TeamRankData[] = teams.map(({ submissions, ...team }) => ({
    ...team, rank: 0, contestUserId: team.id,
    ...scoreContestTeam(submissions, problems, contest, { end, firstSolves, freezeAt, includeUpsolving }),
  }));
  rankings.sort(compareTeamScores);
  setTeamRanks(rankings);
  return { rankings, firstSolves };
}

// Submissions must be in chronological order, with displayId breaking ties.
export function scoreContestTeam(
  submissions: readonly Run[], problems: StandingsProblem[], contest: ContestClock,
  { end, firstSolves, freezeAt = Infinity, includeUpsolving = false }: {
    end: number; firstSolves: ReadonlyMap<number, Run>; freezeAt?: number; includeUpsolving?: boolean;
  },
): Pick<TeamRankData, "solved" | "penalty" | "problems"> {
  const runsByProblem = new Map<number, Run[]>();
  for (const run of submissions) {
    if (run.verdict === "COMPILE_ERROR" || run.verdict === "SYSTEM_ERROR") continue;
    const runs = runsByProblem.get(run.problemId);
    if (runs) runs.push(run);
    else runsByProblem.set(run.problemId, [run]);
  }
  let solved = 0;
  let penalty = 0;
  const results = problems.map(problem => {
    const runs = runsByProblem.get(problem.problemId);
    if (!runs) return null;
    const official = runs.filter(run => run.submittedAt >= contest.startTime && +run.submittedAt <= end);
    const visible = official.filter(run => +run.submittedAt < freezeAt);
    const acceptedIndex = visible.findIndex(run => run.verdict === "ACCEPTED");
    const accepted = visible[acceptedIndex];
    const tries = accepted ? acceptedIndex : visible.length;
    const attempts = accepted ? visible.slice(0, acceptedIndex) : visible;
    const pendingTries = attempts.filter(run => run.verdict === "PENDING" || run.verdict === "JUDGING").length;
    const minutes = accepted ? Math.floor((+accepted.submittedAt - +contest.startTime) / 60_000) : 0;
    if (accepted) {
      solved++;
      penalty += minutes + (tries - pendingTries) * 20;
    }
    const upsolve = !accepted && includeUpsolving
      ? runs.find(run => run.submittedAt > contest.endTime && run.verdict === "ACCEPTED") : undefined;
    return {
      ...problem, firstBlood: !!accepted && accepted.id === firstSolves.get(problem.problemId)?.id,
      accepted: !!accepted, time: accepted ? String(minutes) : "", tries,
      frozenTries: accepted ? 0 : official.length - visible.length, unfrozenTries: tries,
      pendingTries,
      firstAcceptedSubmissionId: (accepted ?? upsolve)?.displayId, upsolved: !!upsolve,
    };
  });
  return { solved, penalty, problems: results };
}

type TeamPlacement = Pick<TeamRankData, "category" | "solved" | "penalty" | "rank">;

export function setTeamRanks(rankings: TeamPlacement[]) {
  let position = 0;
  let previous: TeamPlacement | undefined;
  for (const team of rankings) {
    if (team.category === "1") {
      team.rank = "*";
      continue;
    }
    position++;
    team.rank = previous?.solved === team.solved && previous.penalty === team.penalty ? previous.rank : position;
    previous = team;
  }
}

export function assignTeamMedals(
  rankings: Pick<TeamRankData, "solved" | "category" | "medal">[], config?: Partial<ContestMedalConfig>,
) {
  const recipients = getMedalists(rankings.filter(team => team.category !== "1"), config);
  for (const team of rankings) team.medal = "";
  for (const team of recipients.gold) team.medal = "Gold";
  for (const team of recipients.silver) team.medal = "Silver";
  for (const team of recipients.bronze) team.medal = "Bronze";
}
