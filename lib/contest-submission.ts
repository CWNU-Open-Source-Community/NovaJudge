import {
  ContestRole,
  ContestStatus,
  Verdict,
  type Prisma,
  type Submission,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Dictionary } from "@/lib/dictionaries";
import { enqueueJudge } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { getJwtSecretKey } from "@/lib/auth";
import { hasContestAccess } from "@/lib/contest-access";
import { verifyContestAccessToken } from "@/lib/contest-access-token";
import {
  getRunningVirtualParticipation,
  isVpEnabled,
} from "@/lib/virtual-participation";

type ContestFreezeConfig = {
  frozenDuration?: number;
};

const QUEUE_TIMEOUT_MS = 5000;

export class ContestSubmissionError extends Error {
  constructor(readonly code: keyof Dictionary["submissionErrors"], message: string) {
    super(message);
  }
}

export type SubmissionActor =
  | {
      type: "contest";
      userId: string;
      role: string;
      isGlobalAdmin?: boolean;
    }
  | {
      type: "global";
      globalUserId: string;
      isGlobalAdmin?: boolean;
    };

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function getNextDisplayId(contestId: number) {
  const key = `contest:${contestId}:display_id`;
  const nextId = await withTimeout(
    redis.incr(key),
    QUEUE_TIMEOUT_MS,
    "Redis is unavailable while generating submission id.",
  );

  if (nextId === 1) {
    const lastSubmission = await prisma.submission.findFirst({
      where: { contestId },
      orderBy: { displayId: "desc" },
      select: { displayId: true },
    });

    const dbMaxId = lastSubmission?.displayId || 0;
    if (dbMaxId >= 1) {
      return await withTimeout(
        redis.incrby(key, dbMaxId),
        QUEUE_TIMEOUT_MS,
        "Redis is unavailable while syncing submission id.",
      );
    }
  }

  return nextId;
}

export async function createContestSubmission({
  contestId,
  problemDisplayId,
  language,
  code,
  actor,
  contestAccessToken,
  persistSubmission,
}: {
  contestId: number;
  problemDisplayId: string;
  language: string;
  code: string;
  actor: SubmissionActor;
  contestAccessToken?: string;
  persistSubmission?: (data: Prisma.SubmissionUncheckedCreateInput) => Promise<Submission>;
}) {
  const contestProblem = await prisma.contestProblem.findFirst({
    where: {
      contestId,
      displayId: problemDisplayId,
    },
    include: {
      contest: true,
      problem: { select: { title: true } },
    },
  });

  if (!contestProblem) {
    throw new ContestSubmissionError("problemNotFound", "Problem not found in this contest");
  }

  const now = new Date();
  const contest = contestProblem.contest;
  if (contest.type === "PRIVATE") {
    const tokenAllowed = !!contestAccessToken && await verifyContestAccessToken(
      contestAccessToken, contest, getJwtSecretKey(),
    );
    if (!tokenAllowed && !(await hasContestAccess(contestId))) {
      throw new ContestSubmissionError("passwordRequired", "请先输入比赛密码");
    }
  }
  const config = contest.config as ContestFreezeConfig | null;
  const isEnded =
    contest.status === ContestStatus.ENDED || now >= contest.endTime;

  let isFrozen = false;
  if (config?.frozenDuration) {
    const freezeTime = new Date(
      contest.endTime.getTime() - config.frozenDuration * 60 * 1000,
    );
    isFrozen = now >= freezeTime;
  }

  if (actor.type === "contest") {
    const contestUser = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { contestId: true, role: true },
    });

    if (
      !contestUser ||
      contestUser.contestId !== contestId ||
      contestUser.role !== ContestRole.TEAM
    ) {
      throw new ContestSubmissionError("teamRequired", "Only teams in this contest can submit code.");
    }

    if (now < contest.startTime) {
      throw new ContestSubmissionError("notStarted", "The contest has not started yet.");
    }

    if (isEnded && isFrozen) {
      throw new ContestSubmissionError(
        "frozen",
        "Submissions are disabled while the ended contest is still frozen.",
      );
    }
  }

  let virtualParticipationId: string | null = null;

  if (actor.type === "global") {
    const globalUser = await prisma.globalUser.findUnique({
      where: { id: actor.globalUserId },
      select: { externalId: true, isBanned: true },
    });

    if (!globalUser || globalUser.isBanned) {
      throw new ContestSubmissionError("globalAccountUnavailable", "Global user is unavailable.");
    }

    if (!isEnded) {
      throw new ContestSubmissionError("globalAfterContest", "Global submissions are available after the contest ends.");
    }

    const isExternalUser = globalUser.externalId !== null;
    const vp = await getRunningVirtualParticipation(
      contestId,
      actor.globalUserId,
      now,
    );

    if (vp) {
      virtualParticipationId = vp.id;
    } else if (!isExternalUser) {
      if (!isVpEnabled(contest.config)) {
        throw new ContestSubmissionError("vpDisabled", "Virtual participation is not enabled for this contest.");
      }
      throw new ContestSubmissionError("startVp", "Start virtual participation before submitting.");
    }
  }

  const nextId = await getNextDisplayId(contestId);

  const submissionData: Prisma.SubmissionUncheckedCreateInput = {
    displayId: nextId,
    code,
    language,
    contestId,
    problemId: contestProblem.problemId,
    userId: actor.type === "contest" ? actor.userId : null,
    globalUserId: actor.type === "global" ? actor.globalUserId : null,
    virtualParticipationId,
    verdict: Verdict.PENDING,
    codeLength: code.length,
  };
  // An optional persistence hook can revalidate authorization atomically with
  // this insert. It must finish its transaction before judge jobs are queued.
  const submission = persistSubmission
    ? await persistSubmission(submissionData)
    : await prisma.submission.create({ data: submissionData });

  try {
    await withTimeout(
      enqueueJudge(submission.id),
      QUEUE_TIMEOUT_MS,
      "Judge queue is unavailable. Please contact staff.",
    );
  } catch (error) {
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        verdict: Verdict.SYSTEM_ERROR,
        errorMessage:
          error instanceof Error ? error.message : "Judge queue unavailable.",
      },
    });
    throw error;
  }

  return {
    id: submission.id,
    displayId: submission.displayId,
    contestId,
    problemId: contestProblem.problemId,
    problemDisplayId,
    problemTitle: contestProblem.problem.title,
    language,
    verdict: submission.verdict,
    submittedAt: submission.submittedAt,
  };
}
