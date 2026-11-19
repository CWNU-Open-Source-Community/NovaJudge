"use server";

import { getContestAccess } from "@/lib/contest-access";
import { getTeamInterface } from "@/lib/contest-interface";
import { canViewBoardRuns, elapsedContestTime, scoreboardClock } from "@/lib/domjudge-scoreboard";
import { scoreboardVerdict } from "@/lib/domjudge-verdict";
import { contestLanguages } from "@/lib/contest-languages";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";
import { prisma } from "@/lib/prisma";

export async function getBoardRuns(contestId: number, teamId: string, problemId: number) {
  if (!Number.isSafeInteger(contestId) || contestId <= 0 || !Number.isSafeInteger(problemId) || problemId <= 0 ||
      typeof teamId !== "string" || !teamId || teamId.length > 100) return null;

  const [viewer, access] = await Promise.all([getTeamInterface(), getContestAccess(contestId)]);
  if (!access.allowed || viewer?.contestId !== contestId || !viewer.domjudge) return null;
  const contest = await prisma.contest.findUnique({
    where: { id: contestId }, select: { id: true, title: true, status: true, startTime: true, endTime: true, config: true },
  });
  if (!contest) return null;
  const now = new Date();
  const clock = scoreboardClock(contest, now);
  if (!canViewBoardRuns(clock, viewer.userId, teamId)) return null;

  const runs = await prisma.submission.findMany({
    where: {
      ...getOfficialSubmissionWhere({ contestId, startTime: contest.startTime, endTime: contest.endTime, visibleUntil: now }),
      userId: teamId, problemId, problem: { contestProblems: { some: { contestId } } },
    },
    select: { displayId: true, submittedAt: true, language: true, verdict: true },
    orderBy: [{ submittedAt: "desc" }, { displayId: "desc" }],
  });
  return runs.map(run => {
    const hidden = +run.submittedAt >= clock.freezeAt;
    return {
      detailId: hidden ? null : run.displayId,
      time: elapsedContestTime(contest.startTime, run.submittedAt),
      language: contestLanguages.find(lang => lang.value === run.language)?.label ?? run.language,
      result: scoreboardVerdict(hidden ? "PENDING" : run.verdict, clock.released),
    };
  });
}
