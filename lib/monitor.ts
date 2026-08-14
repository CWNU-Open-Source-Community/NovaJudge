import { prisma } from "./prisma";
import {
  listJudgeWorkers,
  getJudgeQueueStats,
  type JudgeWorkerInfo,
} from "./worker-registry";
import { ContestStatus } from "./generated/prisma/enums";

// ================= 监控统计 =================

export interface MonitorMinuteBucket {
  /** "HH:MM" 标签（服务器本地时间） */
  minute: string;
  /** 该分钟内提交数 */
  count: number;
}

export interface MonitorVerdictBucket {
  verdict: string;
  count: number;
}

export interface MonitorStats {
  /** 在线判题机 */
  workers: JudgeWorkerInfo[];
  /** 判题队列各状态计数（Redis 不可用时为 null） */
  queue: Record<string, number> | null;
  /** 最近 60 分钟的每分钟提交数（时间升序） */
  minutes: MonitorMinuteBucket[];
  /** 最近 60 分钟的判定结果分布 */
  verdicts: MonitorVerdictBucket[];
  /** 最近 10 分钟有提交的队伍/用户数（在线活跃数） */
  onlineTeams: number;
  /** 运行中的比赛数 */
  runningContests: number;
  /** 最近 60 分钟提交总数 */
  submissionsLastHour: number;
  /** 最近 10 分钟提交总数 */
  submissionsLast10Min: number;
}

const WINDOW_MINUTES = 60;
const ACTIVE_WINDOW_MS = 10 * 60_000;

/** 汇总判题管道 + 比赛活跃度数据，供 /admin/monitor 页面与 API 使用 */
export async function getMonitorStats(): Promise<MonitorStats> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const [workers, queue, rows, runningContests] = await Promise.all([
    listJudgeWorkers(),
    getJudgeQueueStats(),
    prisma.submission.findMany({
      where: { submittedAt: { gte: since } },
      select: {
        submittedAt: true,
        verdict: true,
        userId: true,
        globalUserId: true,
      },
    }),
    prisma.contest.count({ where: { status: ContestStatus.RUNNING } }),
  ]);

  const nowMs = Date.now();
  // 第一分钟的整点起点
  const startMs =
    Math.floor(nowMs / 60000) * 60000 - (WINDOW_MINUTES - 1) * 60000;
  const counts = new Array<number>(WINDOW_MINUTES).fill(0);
  const verdictCounts = new Map<string, number>();
  const activeSubmitters = new Set<string>();
  const cutoffActive = nowMs - ACTIVE_WINDOW_MS;
  let submissionsLast10Min = 0;

  for (const row of rows) {
    const t = row.submittedAt.getTime();
    const idx = Math.floor((t - startMs) / 60000);
    if (idx >= 0 && idx < WINDOW_MINUTES) counts[idx]++;

    verdictCounts.set(row.verdict, (verdictCounts.get(row.verdict) ?? 0) + 1);

    if (t >= cutoffActive) {
      submissionsLast10Min++;
      if (row.userId) activeSubmitters.add(`u:${row.userId}`);
      if (row.globalUserId) activeSubmitters.add(`g:${row.globalUserId}`);
    }
  }

  const minutes: MonitorMinuteBucket[] = counts.map((count, i) => {
    const d = new Date(startMs + i * 60000);
    const label = `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
    return { minute: label, count };
  });

  const verdicts: MonitorVerdictBucket[] = [...verdictCounts.entries()]
    .map(([verdict, count]) => ({ verdict, count }))
    .sort((a, b) => b.count - a.count);

  return {
    workers,
    queue,
    minutes,
    verdicts,
    onlineTeams: activeSubmitters.size,
    runningContests,
    submissionsLastHour: rows.length,
    submissionsLast10Min,
  };
}
