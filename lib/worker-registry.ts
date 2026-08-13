import { redis } from "./redis";
import { judgeQueue } from "./queue";

// 判题机在 Redis 中的注册信息
export const JUDGE_WORKER_KEY_PREFIX = "judge:worker:";

// 心跳过期时间（秒）。Worker 每 5 秒续期一次，超过 15 秒没有心跳即视为离线，
// 对应的 Redis key 会自动过期消失。
export const JUDGE_WORKER_HEARTBEAT_TTL = 15;

// 比赛状态调度器（PENDING->RUNNING->ENDED）的租约 key，
// 用于在多台判题机之间选出一个 leader 来执行，避免重复调度。
export const SCHEDULER_LEASE_KEY = "judge:scheduler:leader";

export interface JudgeWorkerInfo {
  /** 判题机唯一编号，例如 "1"、"2"、"MacBook-3" */
  id: string;
  pid: number;
  hostname: string;
  platform: string;
  /** 单机并发判题数（JUDGE_CONCURRENCY） */
  concurrency: number;
  startedAt: number;
  lastHeartbeat: number;
  /** 已处理完的任务数 */
  processed: number;
  /** 当前正在处理的任务 */
  activeJobs: { jobId: string; submissionId: string }[];
  /** 该判题机使用的 go-judge 地址 */
  judgeApi: string;
}

function keyOf(id: string) {
  return `${JUDGE_WORKER_KEY_PREFIX}${id}`;
}

/** 注册 / 刷新一台判题机的心跳信息 */
export async function registerJudgeWorker(info: JudgeWorkerInfo) {
  await redis.set(
    keyOf(info.id),
    JSON.stringify(info),
    "EX",
    JUDGE_WORKER_HEARTBEAT_TTL,
  );
}

/** 判题机关闭时注销自己 */
export async function unregisterJudgeWorker(id: string) {
  await redis.del(keyOf(id));
}

/** 列出当前所有在线的判题机（按 ID 排序，数字优先） */
export async function listJudgeWorkers(): Promise<JudgeWorkerInfo[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = (await redis.scan(
      cursor,
      "MATCH",
      `${JUDGE_WORKER_KEY_PREFIX}*`,
      "COUNT",
      200,
    )) as [string, string[]];
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const now = Date.now();
  const workers: JudgeWorkerInfo[] = [];

  for (let i = 0; i < keys.length; i++) {
    const raw = values[i];
    if (!raw) continue; // key 刚好过期了
    try {
      const info = JSON.parse(raw) as JudgeWorkerInfo;
      // 双保险：心跳超过 TTL 的直接视为离线（正常情况下 key 已过期）
      if (now - info.lastHeartbeat > JUDGE_WORKER_HEARTBEAT_TTL * 1000) continue;
      workers.push(info);
    } catch {
      // 忽略损坏的数据
    }
  }

  workers.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  return workers;
}

/** 获取判题队列的统计信息 */
export async function getJudgeQueueStats(): Promise<Record<string, number> | null> {
  try {
    const counts = await judgeQueue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    return counts as Record<string, number>;
  } catch {
    // Redis 不可用时返回 null，前端显示为不可用
    return null;
  }
}

/**
 * 尝试获取比赛状态调度器的租约（5 秒）。
 * 只有拿到租约的判题机才执行 updateContestStatus，避免多台判题机重复调度。
 */
export async function tryAcquireSchedulerLease(workerId: string) {
  const ok = await redis.set(SCHEDULER_LEASE_KEY, workerId, "EX", 5, "NX");
  return ok === "OK";
}
