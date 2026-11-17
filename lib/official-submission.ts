import { ContestRole, Prisma } from "@/lib/generated/prisma/client";

type OfficialSubmissionWindow = {
  contestId: number;
  startTime: Date;
  endTime: Date;
  visibleUntil?: Date;
  exclusiveUpperBound?: boolean;
};

/**
 * Official standings only include contest-team submissions made inside the
 * contest clock. Global-user upsolving and virtual participation stay out.
 */
export function getOfficialSubmissionWhere({
  contestId,
  startTime,
  endTime,
  visibleUntil,
  exclusiveUpperBound = false,
}: OfficialSubmissionWindow): Prisma.SubmissionWhereInput {
  const upperBound = new Date(
    Math.min(endTime.getTime(), (visibleUntil ?? endTime).getTime()),
  );

  return {
    contestId,
    userId: { not: null },
    globalUserId: null,
    virtualParticipationId: null,
    user: {
      is: {
        contestId,
        role: ContestRole.TEAM,
      },
    },
    submittedAt: {
      gte: startTime,
      ...(exclusiveUpperBound ? { lt: upperBound } : { lte: upperBound }),
    },
  };
}
