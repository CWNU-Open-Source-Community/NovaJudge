import { randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { Verdict } from "./generated/prisma/enums";
import { requireContestManager } from "./contest-management-auth";
import { formatMessage, zh, type Dictionary } from "./dictionaries";
import { buildContestSubmissionWhere } from "./contest-submission-query";
import { prisma } from "./prisma";
import { enqueueJudge, judgeQueue, judgeQueueConnection as redis } from "./queue";
import {
  MAX_CONTEST_REJUDGE_BATCH,
  type ContestRejudgePreview,
  type ContestRejudgeProgress,
  type ContestRejudgeRequest,
  type ContestRejudgeResult,
} from "./contest-rejudge-types";

const SNAPSHOT_TTL_SECONDS = 10 * 60;
const TAKE_SNAPSHOT = "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v";
const RELEASE_LOCK = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function checkedIds(value: unknown, copy: Dictionary["rejudge"]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONTEST_REJUDGE_BATCH ||
    value.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) {
    throw new Error(formatMessage(copy.selectValid, { limit: MAX_CONTEST_REJUDGE_BATCH }));
  }
  return [...new Set(value as string[])];
}

export function rejudgeEligibility(includeAccepted = false): Prisma.SubmissionWhereInput {
  const excluded: Verdict[] = [Verdict.PENDING, Verdict.JUDGING];
  if (!includeAccepted) excluded.push(Verdict.ACCEPTED);
  return { verdict: { notIn: excluded } };
}

/** Caller must authorize the scope. Shared by contest and global administrator actions. */
export async function requeueSubmission(
  submissionId: string,
  options: { contestId?: number; includeAccepted?: boolean } = {},
): Promise<"queued" | "skipped" | "failed"> {
  const lockKey = `rejudge:submission:${submissionId}`;
  const lockOwner = randomUUID();
  const locked = await redis.set(lockKey, lockOwner, "EX", 60, "NX");
  if (!locked) return "skipped";
  try {
    const scope = {
      id: submissionId,
      ...(options.contestId !== undefined && { contestId: options.contestId }),
    };
    const submission = await prisma.submission.findFirst({
      where: { ...scope, ...rejudgeEligibility(options.includeAccepted) },
      select: {
        verdict: true, timeUsed: true, memoryUsed: true, errorMessage: true,
        passedTests: true, totalTests: true,
      },
    });
    if (!submission) return "skipped";

    // A worker can have written its final verdict while its BullMQ job is still active.
    // Do not reset that row: enqueueJudge would otherwise reuse the old job.
    const existing = await judgeQueue.getJob(`judge-sub-${submissionId}`);
    if (existing) {
      const state = await existing.getState();
      if (!["completed", "failed", "unknown"].includes(state)) return "skipped";
    }

    const reset = await prisma.submission.updateMany({
      where: { ...scope, verdict: submission.verdict },
      data: {
        verdict: Verdict.PENDING, timeUsed: null, memoryUsed: null,
        errorMessage: null, passedTests: 0, totalTests: 0,
      },
    });
    if (reset.count !== 1) return "skipped";

    let enqueueResult: Awaited<ReturnType<typeof enqueueJudge>>;
    try {
      enqueueResult = await enqueueJudge(submissionId);
    } catch {
      // Redis may have accepted the job even if the caller lost the response.
      const job = await judgeQueue.getJob(`judge-sub-${submissionId}`).catch(() => undefined);
      const state = await job?.getState().catch(() => undefined);
      if (state && !["completed", "failed", "unknown"].includes(state)) return "queued";
      if (state === "completed") {
        const current = await prisma.submission.findFirst({ where: scope, select: { verdict: true } });
        if (current && current.verdict !== Verdict.PENDING && current.verdict !== Verdict.JUDGING) return "queued";
      }
      // Restore only an untouched pending row; never overwrite a running worker's result.
      await prisma.submission.updateMany({
        where: { ...scope, verdict: Verdict.PENDING },
        data: submission,
      });
      return "failed";
    }
    if (enqueueResult.outcome === "already-active") {
      // The old job may become active between the first queue read and enqueue.
      // Restore only our pending reset; a worker's new state always wins.
      await prisma.submission.updateMany({
        where: { ...scope, verdict: Verdict.PENDING },
        data: submission,
      });
      return "skipped";
    }
    return "queued";
  } finally {
    await redis.eval(RELEASE_LOCK, 1, lockKey, lockOwner).catch(() => undefined);
  }
}

export async function previewRejudge(
  contestId: number,
  request: ContestRejudgeRequest,
  dict: Dictionary = zh,
): Promise<ContestRejudgePreview> {
  try {
    const actor = await requireContestManager(contestId, dict.rejudge.managerRequired);
    if (!request || typeof request !== "object" ||
      (request.includeAccepted !== undefined && typeof request.includeAccepted !== "boolean")) {
      throw new Error(dict.rejudge.invalidRequest);
    }
    const filters = await buildContestSubmissionWhere(contestId, request.filters, dict);
    const ids = request.submissionIds === undefined ? undefined : checkedIds(request.submissionIds, dict.rejudge);
    const submissions = await prisma.submission.findMany({
      where: { AND: [filters, rejudgeEligibility(request.includeAccepted), ...(ids ? [{ id: { in: ids } }] : [])] },
      take: MAX_CONTEST_REJUDGE_BATCH + 1,
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      select: {
        id: true, displayId: true, problemId: true, verdict: true,
        user: { select: { displayName: true, username: true } },
        globalUser: { select: { displayName: true, username: true } },
      },
    });
    if (submissions.length > MAX_CONTEST_REJUDGE_BATCH) {
      throw new Error(formatMessage(dict.rejudge.tooMany, { limit: MAX_CONTEST_REJUDGE_BATCH }));
    }
    if (!submissions.length) return { count: 0, sample: [] };

    const problems = await prisma.contestProblem.findMany({
      where: { contestId }, select: { problemId: true, displayId: true },
    });
    const labels = new Map(problems.map((p) => [p.problemId, p.displayId]));
    const token = randomUUID();
    const snapshot = {
      contestId, actorKey: actor.key,
      submissionIds: submissions.map((submission) => submission.id),
      includeAccepted: request.includeAccepted === true,
    };
    await redis.set(`rejudge:preview:${contestId}:${actor.key}:${token}`, JSON.stringify(snapshot), "EX", SNAPSHOT_TTL_SECONDS);
    return {
      token, count: submissions.length,
      sample: submissions.slice(0, 5).map((submission) => ({
        id: submission.id, displayId: submission.displayId,
        teamName: submission.user?.displayName || submission.user?.username ||
          submission.globalUser?.displayName || submission.globalUser?.username || dict.common.unknown,
        problemLabel: labels.get(submission.problemId) || String(submission.problemId),
        verdict: submission.verdict,
      })),
    };
  } catch (error) {
    return { error: errorMessage(error, dict.rejudge.processingFailed) };
  }
}

export async function executeRejudge(contestId: number, token: string, dict: Dictionary = zh): Promise<ContestRejudgeResult> {
  try {
    const actor = await requireContestManager(contestId, dict.rejudge.managerRequired);
    if (typeof token !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token)) {
      throw new Error(dict.rejudge.invalidPreview);
    }
    // Actor-specific keys prevent another manager from consuming this preview.
    const raw = await redis.eval(TAKE_SNAPSHOT, 1, `rejudge:preview:${contestId}:${actor.key}:${token}`);
    if (typeof raw !== "string") throw new Error(dict.rejudge.expiredPreview);
    const snapshot = JSON.parse(raw) as { contestId: number; actorKey: string; submissionIds: string[]; includeAccepted: boolean };
    if (snapshot.contestId !== contestId || snapshot.actorKey !== actor.key) throw new Error(dict.rejudge.wrongPreview);
    const ids = checkedIds(snapshot.submissionIds, dict.rejudge);
    const queuedIds: string[] = [];
    let skipped = 0;
    let failed = 0;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const outcome = await requeueSubmission(id, {
          contestId, includeAccepted: snapshot.includeAccepted === true,
        }).catch(() => "failed" as const);
        if (outcome === "queued") queuedIds.push(id);
        else if (outcome === "skipped") skipped++;
        else failed++;
      }
    }));
    return { queued: queuedIds.length, skipped, failed, submissionIds: queuedIds };
  } catch (error) {
    return { error: errorMessage(error, dict.rejudge.processingFailed) };
  }
}

export async function readRejudgeProgress(contestId: number, submissionIds: string[], dict: Dictionary = zh): Promise<ContestRejudgeProgress> {
  try {
    await requireContestManager(contestId, dict.rejudge.managerRequired);
    const ids = checkedIds(submissionIds, dict.rejudge);
    const submissions = await prisma.submission.findMany({
      where: { contestId, id: { in: ids } }, select: { id: true, verdict: true },
    });
    if (submissions.length !== ids.length) throw new Error(dict.rejudge.missingSubmissions);
    const result = { pending: 0, judging: 0, completed: 0, failed: 0 };
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, submissions.length) }, async () => {
      while (cursor < submissions.length) {
        const submission = submissions[cursor++];
        if (submission.verdict === Verdict.SYSTEM_ERROR) result.failed++;
        else if (submission.verdict === Verdict.PENDING || submission.verdict === Verdict.JUDGING) {
          const job = await judgeQueue.getJob(`judge-sub-${submission.id}`);
          const state = await job?.getState();
          if (!state || ["completed", "failed", "unknown"].includes(state)) {
            // The worker may have finished after our first database read.
            const current = await prisma.submission.findFirst({
              where: { id: submission.id, contestId }, select: { verdict: true },
            });
            if (current && current.verdict !== Verdict.PENDING &&
              current.verdict !== Verdict.JUDGING && current.verdict !== Verdict.SYSTEM_ERROR) result.completed++;
            else result.failed++;
          } else if (submission.verdict === Verdict.PENDING) result.pending++;
          else result.judging++;
        } else result.completed++;
      }
    }));
    return result;
  } catch (error) {
    return { error: errorMessage(error, dict.rejudge.processingFailed) };
  }
}
