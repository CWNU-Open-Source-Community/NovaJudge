"use server";

import { prisma } from "@/lib/prisma";
import os from "os";
import { LANGUAGES } from "@/lib/judge";
import { listJudgeWorkers, getJudgeQueueStats } from "@/lib/worker-registry";

// 获取支持的语言列表
export async function getSupportedLanguages() {
  return LANGUAGES;
}

// 获取当前所有在线的判题机（含 ID、心跳、已判数量等）与队列统计
export async function getJudgeWorkersOverview() {
  const [workers, queue] = await Promise.all([
    listJudgeWorkers(),
    getJudgeQueueStats(),
  ]);
  return { workers, queue };
}

// 获取判题机状态 (从 Go-Judge 获取)
async function getJudgeStatus() {
  try {
    const GO_JUDGE_URL = process.env.GO_JUDGE_API || "http://localhost:5050";
    // Go-Judge 的 /version 接口返回的结构可能是 { version: "x.y.z", ... }
    // 如果失败，尝试 /config 或者直接认为在线但未知版本
    const res = await fetch(`${GO_JUDGE_URL}/version`, {
      next: { revalidate: 0 },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      // Go-Judge 返回的 version 字段可能在不同版本有所不同，这里做一个容错
      // 常见结构: { buildTime: "...", goVersion: "...", platform: "...", version: "..." }
      return {
        status: "online",
        version: data.version || data.buildVersion || "Unknown",
      };
    }
    return { status: "offline", version: "N/A" };
  } catch (e) {
    console.error("Judge status check failed:", e);
    return { status: "offline", version: "N/A" };
  }
}

// 获取系统统计信息
export async function getSystemStats() {
  const [contestCount, problemCount, submissionCount, userCount, judgeStatus] =
    await Promise.all([
      prisma.contest.count(),
      prisma.problem.count(),
      prisma.submission.count(),
      prisma.globalUser.count(),
      getJudgeStatus(),
    ]);

  // 获取系统负载信息
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  // Windows 上 os.loadavg() 通常返回 [0, 0, 0]，因为它没有像 Unix 那样的平均负载概念
  // 这里做一个简单的回退，如果是 Windows 且全为 0，我们尝试用其他方式或者返回 null 让前端处理
  const isWindows = os.platform() === "win32";
  if (isWindows && loadAvg[0] === 0 && loadAvg[1] === 0 && loadAvg[2] === 0) {
    // 在 Windows 上我们无法轻易获得准确的 loadAvg，这里可以返回模拟数据或者 null
    // 为了界面不崩，我们保持 [0,0,0] 但前端可以展示为 "N/A" 或者隐藏
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    counts: {
      contests: contestCount,
      problems: problemCount,
      submissions: submissionCount,
      users: userCount,
    },
    judge: judgeStatus,
    system: {
      cpuModel: cpus[0]?.model || "Unknown CPU",
      cpuCount: cpus.length,
      loadAvg: loadAvg, // [1min, 5min, 15min]
      platform: os.platform(), // 添加平台信息供前端判断
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
      },
      uptime: os.uptime(),
    },
  };
}
