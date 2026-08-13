import { Queue } from "bullmq";
import { redis } from "./redis";

// 定义判题任务队列
export const judgeQueue = new Queue("judge-queue", {
  connection: redis, // 或者使用单独的 connection 配置
});

// 队列名称（worker.ts 使用同一个名称）
export const JUDGE_QUEUE_NAME = "judge-queue";

/**
 * 幂等地将一次提交放入判题队列。
 *
 * 使用固定 jobId（judge-sub-<submissionId>）保证：
 * 1. 同一个提交不会被重复入队 —— 即使重复点击 / 并发重判，队列里也只有一个任务；
 * 2. 如果该提交已经有一个任务正在被某台判题机处理（active），直接复用该任务，
 *    不会产生第二个任务，从而避免多台判题机同时判同一份提交；
 * 3. 如果旧任务已经结束（completed / failed / waiting / delayed），先移除旧任务再
 *    入队，保证「重判」依然生效。
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
      return existing;
    }
    // 旧任务已结束（完成/失败/等待等），移除后重新入队（例如重判场景）
    await existing.remove().catch(() => {
      // 忽略并发删除时的竞态错误
    });
  }

  // BullMQ 的 add 对相同 jobId 的处理是原子的：即使并发调用，也只会存在一个任务
  return judgeQueue.add("judge", { submissionId }, { jobId });
}
