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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Redis 同一前缀下还存放编号计数器；只接受完整、有效的心跳记录。 */
export function parseJudgeWorkerInfo(raw: string | null): JudgeWorkerInfo | null {
  if (!raw) return null;
  try {
    const info: unknown = JSON.parse(raw);
    if (!isRecord(info)) return null;
    if (typeof info.id !== "string" || !info.id.trim()) return null;
    for (const field of ["hostname", "platform", "judgeApi"] as const) {
      if (typeof info[field] !== "string") return null;
    }
    for (const field of ["pid", "concurrency", "startedAt", "lastHeartbeat", "processed"] as const) {
      if (typeof info[field] !== "number" || !Number.isFinite(info[field])) return null;
    }
    if (!Array.isArray(info.activeJobs) || !info.activeJobs.every((job: unknown) =>
      isRecord(job) && typeof job.jobId === "string" && typeof job.submissionId === "string",
    )) return null;
    return info as unknown as JudgeWorkerInfo;
  } catch {
    return null;
  }
}
