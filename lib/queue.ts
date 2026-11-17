import { Queue } from "bullmq";
import Redis from "ioredis";
import { JUDGE_QUEUE_NAME } from "./queue-constants";

export { JUDGE_QUEUE_NAME } from "./queue-constants";

const globalForJudgeQueue = globalThis as unknown as {
  judgeQueueConnection?: Redis;
  judgeQueue?: Queue;
};

// HTTP / Server Action 侧必须快速失败，不能复用 Worker 所需的无限重试连接。
// 否则 Redis 下线时一次提交或批量重判会无限等待，也就无法执行数据库回滚。
export const judgeQueueConnection =
  globalForJudgeQueue.judgeQueueConnection ||
  new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });

// 定义判题任务队列
export const judgeQueue =
  globalForJudgeQueue.judgeQueue ||
  new Queue(JUDGE_QUEUE_NAME, { connection: judgeQueueConnection });

if (process.env.NODE_ENV !== "production") {
  globalForJudgeQueue.judgeQueueConnection = judgeQueueConnection;
  globalForJudgeQueue.judgeQueue = judgeQueue;
}

/**
 * Close both BullMQ and the externally-owned Redis connection.
 *
 * BullMQ deliberately does not close an ioredis instance supplied by the
 * caller, so command-line tools must release both resources before exiting.
 */
export async function closeJudgeQueue(): Promise<void> {
  let queueError: unknown;

  try {
    await judgeQueue.close();
  } catch (error) {
    queueError = error;
  }

  if (judgeQueueConnection.status !== "end") {
    try {
      await judgeQueueConnection.quit();
    } catch {
      judgeQueueConnection.disconnect();
    }
  }

  if (queueError) throw queueError;
}

export type EnqueueJudgeOutcome =
  | "enqueued"
  | "already-queued"
  | "already-active";

export interface EnqueueJudgeResult {
  outcome: EnqueueJudgeOutcome;
}

/**
 * 幂等地将一次提交放入判题队列。
 *
 * 使用固定 jobId（judge-sub-<submissionId>）保证：
 * 1. 同一个提交不会被重复入队 —— 即使重复点击 / 并发重判，队列里也只有一个任务；
 * 2. 如果该提交已经有一个任务正在被某台判题机处理（active），直接复用该任务，
 *    不会产生第二个任务，从而避免多台判题机同时判同一份提交；
 * 3. 如果已有 waiting / delayed 任务则直接复用；只有 completed / failed 等已结束
 *    任务才会先移除再入队，保证「重判」依然生效。
 *
 * 另外，BullMQ 基于 Redis 的原子领取机制，队列里的每个任务只会被一个 Worker
 * 领取，因此多台判题机同时从队列取任务时天然不会冲突。
 */
export async function enqueueJudge(submissionId: string) {
  // 注意：BullMQ 的自定义 jobId 不允许包含 ":"，这里用 "-" 拼接
  const jobId = `judge-sub-${submissionId}`;

  const existing = await judgeQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active") {
      // 已经有判题机在处理该提交，无需重复入队
      return { outcome: "already-active" } satisfies EnqueueJudgeResult;
    }
    if (
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      // 已有待处理任务时复用它，避免删除一个即将被 Worker 领取的任务。
      return { outcome: "already-queued" } satisfies EnqueueJudgeResult;
    }
    // 仅删除已经结束的旧任务。若删除期间任务状态发生变化，则复用现有任务。
    try {
      await existing.remove();
    } catch {
      const latestState = await existing.getState();
      if (latestState === "active") {
        return { outcome: "already-active" } satisfies EnqueueJudgeResult;
      }
      if (
        latestState === "waiting" ||
        latestState === "delayed" ||
        latestState === "prioritized" ||
        latestState === "waiting-children"
      ) {
        return { outcome: "already-queued" } satisfies EnqueueJudgeResult;
      }
      // 另一个并发请求可能已经删除旧任务；此时继续 add 即可，固定 jobId
      // 会让后续并发创建保持幂等。
      if (latestState !== "unknown") {
        throw new Error(
          `Failed to replace existing judge job ${jobId} (state: ${latestState})`,
        );
      }
    }
  }

  // BullMQ 的 add 对相同 jobId 的处理是原子的：即使并发调用，也只会存在一个任务
  await judgeQueue.add(
    "judge",
    { submissionId },
    {
      jobId,
      // Transient PostgreSQL/Redis failures during Worker startup should not
      // strand a submission in PENDING. Application verdicts are handled by
      // judgeSubmission itself and therefore do not trigger these retries.
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    },
  );
  return { outcome: "enqueued" } satisfies EnqueueJudgeResult;
}
