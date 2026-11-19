import { Verdict } from "@/lib/generated/prisma/enums";

type ContestTeam = {
  submissions: ReadonlyArray<{
    problemId: number;
    verdict: Verdict;
    submittedAt: Date;
    globalUserId: string | null;
    virtualParticipationId: string | null;
  }>;
};

type StatsWindow = {
  start: number;
  end: number;
  freezeAt?: number;
};

export type RankProblemStats = {
  problemId: number;
  submitted: number;
  attempted: number;
  accepted: number;
};

export function summarizeRankProblems(
  problemIds: number[],
  teams: ContestTeam[],
  { start, end, freezeAt = Infinity }: StatsWindow,
): RankProblemStats[] {
  const totals = new Map<number, RankProblemStats>(
    problemIds.map((problemId) => [problemId, { problemId, submitted: 0, attempted: 0, accepted: 0 }]),
  );

  for (const team of teams) {
    const attempted = new Set<RankProblemStats>();
    const accepted = new Set<RankProblemStats>();

    for (const submission of team.submissions) {
      const problem = totals.get(submission.problemId);
      const submittedAt = submission.submittedAt.getTime();
      if (!problem || submittedAt < start || submittedAt > end || submittedAt >= freezeAt ||
          submission.globalUserId !== null || submission.virtualParticipationId !== null) {
        continue;
      }

      problem.submitted++;
      attempted.add(problem);
      if (submission.verdict === Verdict.ACCEPTED) accepted.add(problem);
    }

    for (const problem of attempted) problem.attempted++;
    for (const problem of accepted) problem.accepted++;
  }

  return [...totals.values()];
}
