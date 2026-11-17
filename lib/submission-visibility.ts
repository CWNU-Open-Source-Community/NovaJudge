import { ContestRole, ContestStatus } from "@/lib/generated/prisma/client";
import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type SubmissionProgress = {
  verdict: string;
  passedTests: number;
  totalTests: number;
};

export function hideSubmissionProgress<T extends SubmissionProgress>(
  progress: T,
): T {
  return {
    ...progress,
    passedTests: 0,
    totalTests: 0,
  };
}

export async function canViewSubmissionTestDetails(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      contestId: true,
      contest: {
        select: {
          status: true,
          endTime: true,
        },
      },
    },
  });

  if (
    !submission?.contestId ||
    !submission.contest ||
    submission.contest.status !== ContestStatus.RUNNING ||
    new Date() >= submission.contest.endTime
  ) {
    return true;
  }

  const globalUser = await getCurrentSuper();
  if (globalUser) {
    return globalUser.isGlobalAdmin;
  }

  const contestUser = await getCurrentUser();
  return Boolean(
    contestUser?.contestId === submission.contestId &&
      (contestUser.role === ContestRole.ADMIN ||
        contestUser.role === ContestRole.JUDGE),
  );
}
