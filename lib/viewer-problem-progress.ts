import { prisma } from "@/lib/prisma";
import { Verdict, type Prisma } from "@/lib/generated/prisma/client";

/** Who is looking at the problems, resolved the same way as the problem list. */
export interface ProgressViewer {
  userId?: string | null;
  globalUserId?: string | number | null;
  runningVpId?: string | null;
  latestVpId?: string | null;
  /** External global accounts see their post-contest (upsolving) submissions. */
  externalAfterContest?: boolean;
}

export type ProblemProgressState = "solved" | "pending" | "attempted" | "none";

export interface ProblemProgress {
  state: ProblemProgressState;
  tries: number;
}

function viewerSubmissionFilter(viewer: ProgressViewer): Prisma.SubmissionWhereInput | null {
  if (viewer.userId) return { userId: viewer.userId };
  if (!viewer.globalUserId) return null;
  const globalUserId = String(viewer.globalUserId);
  if (viewer.runningVpId) return { globalUserId, virtualParticipationId: viewer.runningVpId };
  if (viewer.externalAfterContest) return { globalUserId, virtualParticipationId: null };
  if (viewer.latestVpId) return { globalUserId, virtualParticipationId: viewer.latestVpId };
  return null;
}

/** The viewer's accepted / judging / attempted state for every problem in a contest. */
export async function getViewerProblemProgress(contestId: number, viewer: ProgressViewer) {
  const personal = Boolean(viewer.userId || viewer.globalUserId);
  const progress = new Map<number, ProblemProgress>();
  const filter = viewerSubmissionFilter(viewer);
  if (!filter) return { personal, progress };

  const submissions = await prisma.submission.findMany({
    where: { contestId, ...filter },
    select: { problemId: true, verdict: true },
  });

  const solved = new Set<number>();
  const pending = new Set<number>();
  const tries = new Map<number, number>();
  for (const submission of submissions) {
    if (submission.verdict === Verdict.ACCEPTED) solved.add(submission.problemId);
    if (submission.verdict === Verdict.PENDING || submission.verdict === Verdict.JUDGING) {
      pending.add(submission.problemId);
    }
    tries.set(submission.problemId, (tries.get(submission.problemId) || 0) + 1);
  }
  for (const [problemId, count] of tries) {
    progress.set(problemId, {
      state: solved.has(problemId) ? "solved" : pending.has(problemId) ? "pending" : "attempted",
      tries: count,
    });
  }
  return { personal, progress };
}
