import "server-only";
import { cache } from "react";
import { getContestAccess } from "./contest-access";
import { usesDomjudge } from "./contest-interface";
import { prisma } from "./prisma";

// Only send team-visible problem labels to the browser, after checking contest access.
export const getDomjudgeContest = cache(async (contestId: number) => {
  if (!(await usesDomjudge(contestId)) || !(await getContestAccess(contestId)).allowed) return null;
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, title: true, status: true, startTime: true, endTime: true, config: true },
  });
  if (!contest) return null;
  const now = new Date();
  const started = contest.status !== "PENDING" && now >= contest.startTime;
  const ended = contest.status === "ENDED" || now >= contest.endTime;
  const freezeMinutes = Number((contest.config as { frozenDuration?: number } | null)?.frozenDuration || 0);
  const frozen = freezeMinutes > 0 && now.getTime() >= contest.endTime.getTime() - freezeMinutes * 60000;
  const canSubmit = started && !(ended && frozen);
  const problems = canSubmit ? await prisma.contestProblem.findMany({
    where: { contestId },
    orderBy: { displayId: "asc" },
    select: { displayId: true, problem: { select: { title: true } } },
  }) : [];
  return {
    id: contest.id, title: contest.title, started, ended,
    start: contest.startTime.getTime(), end: contest.endTime.getTime(),
    canSubmit: canSubmit && problems.length > 0,
    problems: problems.map(({ displayId, problem }) => ({ displayId, title: problem.title })),
  };
});

export type DomjudgeContest = NonNullable<Awaited<ReturnType<typeof getDomjudgeContest>>>;
