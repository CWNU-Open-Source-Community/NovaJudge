import "dotenv/config";
import { Worker } from "bullmq";
import { judgeSubmission } from "./lib/judge";
import { redis } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { ContestStatus } from "./lib/generated/prisma/enums";
import os from "os";
import {
  registerJudgeWorker,
  unregisterJudgeWorker,
  tryAcquireSchedulerLease,
  type JudgeWorkerInfo,
} from "./lib/worker-registry";

// ─────────────────────────────────────────────────────────────
// 1. 解析判题机 ID
//    优先级：命令行 --id 1 / --id=1 > 环境变量 JUDGE_ID > 自动分配
//    worker:multi 脚本会为每台判题机分配 1、2、3…… 这样的编号。
// ─────────────────────────────────────────────────────────────
function resolveWorkerId(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--id=")) return arg.slice("--id=".length).trim();
    if (arg === "--id" || arg === "-i") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) return next.trim();
    }
  }
  return process.env.JUDGE_ID?.trim() || null;
}

async function main() {
  const requestedId = resolveWorkerId();
  // 没指定 ID 时自动分配：<主机名>-<序号>（序号来自 Redis 自增，保证唯一）
  const workerId =
    requestedId || `${os.hostname()}-${await redis.incr("judge:worker:seq")}`;

  const concurrency = Number(process.env.JUDGE_CONCURRENCY || 1);
  const judgeApi = process.env.GO_JUDGE_API || "http://localhost:5050";

  console.log("🚀 Judge Worker Started...");
  console.log(`🆔 Worker ID     : ${workerId}`);
  console.log(`⚙️  Concurrency   : ${concurrency}`);
  console.log(`🧪 go-judge API  : ${judgeApi}`);
  console.log("DB URL Check:", process.env.DATABASE_URL ? "Loaded" : "Missing");

  // ───────────────────────────────────────────────────────────
  // 2. 心跳注册：每 5 秒向 Redis 报告一次自己的状态。
  //    后台首页通过读取这些信息展示所有在线判题机。
  // ───────────────────────────────────────────────────────────
  let processedCount = 0;
  let activeJobs: JudgeWorkerInfo["activeJobs"] = [];
  const startedAt = Date.now();

  async function publishHeartbeat() {
    await registerJudgeWorker({
      id: workerId,
      pid: process.pid,
      hostname: os.hostname(),
      platform: os.platform(),
      concurrency,
      startedAt,
      lastHeartbeat: Date.now(),
      processed: processedCount,
      activeJobs: activeJobs.slice(),
      judgeApi,
    });
  }

  const heartbeatTimer = setInterval(() => {
    publishHeartbeat().catch((err) =>
      console.error(`[${workerId}] Heartbeat failed:`, err?.message ?? err),
    );
  }, 5000);

  // ───────────────────────────────────────────────────────────
  // 3. 判题 Worker
  //
  //    多台判题机同时连接同一个队列不会冲突：
  //    BullMQ 底层基于 Redis 的原子领取机制（每个任务带锁），
  //    一个任务同一时刻只会被一台判题机领取并执行。
  //    入队侧（lib/queue.ts 的 enqueueJudge）还通过固定 jobId 保证
  //    同一提交不会产生重复任务。
  // ───────────────────────────────────────────────────────────
  const worker = new Worker(
    "judge-queue",
    async (job) => {
      console.log(
        `[${workerId}] Processing job ${job.id}: submission ${job.data.submissionId}`,
      );

      await judgeSubmission(job.data.submissionId);

      console.log(`[${workerId}] Job ${job.id} finished.`);
    },
    {
      connection: redis, // 复用连接
      concurrency, // 【并发控制】每台判题机同时判多少题，根据 CPU 核心数调整
      // 完成任务后按数量/时间清理，避免 Redis 内存堆积（重判时 enqueueJudge 会移除旧任务）
      removeOnComplete: { count: 2000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  );

  worker.on("active", (job) => {
    const jobId = String(job.id ?? "");
    const submissionId = String(job.data?.submissionId ?? "");
    activeJobs = [...activeJobs, { jobId, submissionId }];
    publishHeartbeat().catch(() => {});
  });

  worker.on("completed", (job) => {
    processedCount += 1;
    const jobId = String(job.id ?? "");
    activeJobs = activeJobs.filter((a) => a.jobId !== jobId);
    publishHeartbeat().catch(() => {});
    console.log(`[${workerId}] Job ${job.id} has completed!`);
  });

  worker.on("failed", (job, err) => {
    processedCount += 1;
    if (job) {
      const jobId = String(job.id ?? "");
      activeJobs = activeJobs.filter((a) => a.jobId !== jobId);
    }
    publishHeartbeat().catch(() => {});
    console.log(`[${workerId}] Job ${job?.id} has failed with ${err.message}`);
  });

  // ───────────────────────────────────────────────────────────
  // 4. 比赛状态调度器（PENDING -> RUNNING -> ENDED）
  //    多台判题机同时运行时，通过 Redis 租约选出 leader，
  //    只有 leader 执行调度，避免重复工作。
  // ───────────────────────────────────────────────────────────
  async function updateContestStatus() {
    const now = new Date();

    try {
      // 1. 检查并更新：PENDING -> RUNNING
      // 条件：状态是 PENDING 且 当前时间 >= 开始时间
      const startResult = await prisma.contest.updateMany({
        where: {
          status: ContestStatus.PENDING,
          startTime: { lte: now }, // lte: less than or equal to (<=)
        },
        data: {
          status: ContestStatus.RUNNING,
        },
      });

      if (startResult.count > 0) {
        console.log(`[Scheduler] 🚀 Started ${startResult.count} contests.`);
      }

      // 2. 检查并更新：RUNNING -> ENDED
      // 条件：状态是 RUNNING 且 当前时间 >= 结束时间
      const endResult = await prisma.contest.updateMany({
        where: {
          status: ContestStatus.RUNNING,
          endTime: { lte: now },
        },
        data: {
          status: ContestStatus.ENDED,
        },
      });

      if (endResult.count > 0) {
        console.log(`[Scheduler] 🏁 Ended ${endResult.count} contests.`);
      }
    } catch (error) {
      console.error("[Scheduler] Error updating contest status:", error);
    }
  }

  let isSchedulerLeader = false;

  async function schedulerTick() {
    try {
      const acquired = await tryAcquireSchedulerLease(workerId);
      if (acquired) {
        if (!isSchedulerLeader) {
          console.log(`[${workerId}] 👑 Became scheduler leader.`);
        }
        isSchedulerLeader = true;
        await updateContestStatus();
      } else {
        isSchedulerLeader = false;
      }
    } catch (error) {
      console.error("[Scheduler] Lease error:", error);
    }
  }

  schedulerTick();
  const schedulerTimer = setInterval(schedulerTick, 2000);

  // ───────────────────────────────────────────────────────────
  // 5. 优雅退出：注销判题机信息并关闭连接
  // ───────────────────────────────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`[${workerId}] Received ${signal}, shutting down gracefully...`);
    clearInterval(heartbeatTimer);
    clearInterval(schedulerTimer);
    try {
      await unregisterJudgeWorker(workerId);
    } catch {}
    try {
      await worker.close(); // 等待正在处理的任务完成
    } catch {}
    try {
      await redis.quit();
    } catch {}
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await publishHeartbeat();
}

main().catch((err) => {
  console.error("❌ Judge worker failed to start:", err);
  process.exit(1);
});
