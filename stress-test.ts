/**
 * NovaJudge 判题压力测试脚本
 *
 * 仿照 benchmark.ts 编写：批量向数据库写入提交并推入判题队列，
 * 用于压测（多开）判题机的判题吞吐与稳定性。
 *
 * 用法：
 *   npx tsx stress-test.ts [--total=100] [--batch=20] [--lang=cpp]
 *                         [--problem=1] [--no-wait] [--timeout=600] [--mark=xxx]
 *
 * 或者：
 *   npm run stress -- --total=100 --batch=20 --lang=cpp
 *
 * 提示：压测前请先启动判题机（npm run worker 或 npm run worker:multi -- N），
 *       并确认目标题目 ID 存在且有测试数据。
 */
import { prisma } from "./lib/prisma";
import { enqueueJudge, judgeQueue } from "./lib/queue";
import { Verdict } from "@/lib/generated/prisma/enums";
import { listJudgeWorkers, getJudgeQueueStats } from "./lib/worker-registry";
import { redis } from "./lib/redis";

// ---------------- 配置区域 ----------------
const DEFAULTS = {
  PROBLEM_ID: 1, // ⚠️ 目标题目 ID，请确保该题存在且有测试数据
  TOTAL_REQUESTS: 50, // 模拟并发提交的总数量
  BATCH_SIZE: 10, // 每批次并发入队数（防止把本机打死）
  LANGUAGE: "java", // 提交语言：c | cpp | java | pypy3
  WAIT_FOR_RESULTS: true, // 入队后是否等待判题完成并统计结果
  POLL_INTERVAL_MS: 1000, // 轮询判题进度的间隔
  TIMEOUT_MS: 10 * 60 * 1000, // 等待判题完成的超时时间（默认 10 分钟）
};

interface StressConfig {
  PROBLEM_ID: number;
  TOTAL_REQUESTS: number;
  BATCH_SIZE: number;
  LANGUAGE: string;
  WAIT_FOR_RESULTS: boolean;
  POLL_INTERVAL_MS: number;
  TIMEOUT_MS: number;
  MARK?: string; // 可选标记，会以注释形式写入每份提交的代码，便于事后定位/清理
}

// 各语言的 A+B 正确代码
const MOCK_CODES: Record<string, string> = {
  java: `
import java.util.*;
public class Main{
public static void main(String args[]){
Scanner cin = new Scanner(System.in);
int a, b;
a = cin.nextInt(); b = cin.nextInt();
System.out.println(a + b);
}
}
`,
  cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
  long long a, b;
  cin >> a >> b;
  cout << a + b << endl;
  return 0;
}
`,
  c: `
#include <stdio.h>
int main() {
  long long a, b;
  scanf("%lld %lld", &a, &b);
  printf("%lld\n", a + b);
  return 0;
}
`,
  pypy3: `
import sys
a, b = map(int, sys.stdin.read().split())
print(a + b)
`,
};

// 终态 verdict（非 PENDING / JUDGING 即视为判题结束）
const FINAL_VERDICTS = new Set<string>([
  Verdict.ACCEPTED,
  Verdict.WRONG_ANSWER,
  Verdict.TIME_LIMIT_EXCEEDED,
  Verdict.MEMORY_LIMIT_EXCEEDED,
  Verdict.RUNTIME_ERROR,
  Verdict.COMPILE_ERROR,
  Verdict.PRESENTATION_ERROR,
  Verdict.SYSTEM_ERROR,
]);

function parseArgs(argv: string[]): StressConfig {
  const cfg: StressConfig = { ...DEFAULTS };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    switch (key) {
      case "total":
        cfg.TOTAL_REQUESTS = Number(value);
        break;
      case "batch":
        cfg.BATCH_SIZE = Number(value);
        break;
      case "lang":
        // 兼容习惯写法：python 视为 pypy3
        cfg.LANGUAGE = value === "python" ? "pypy3" : value;
        break;
      case "problem":
        cfg.PROBLEM_ID = Number(value);
        break;
      case "no-wait":
        cfg.WAIT_FOR_RESULTS = false;
        break;
      case "timeout":
        cfg.TIMEOUT_MS = Number(value) * 1000;
        break;
      case "mark":
        cfg.MARK = value;
        break;
    }
  }
  return cfg;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(1)}s`;
}

// 可选：在代码开头写入标记注释，方便事后在数据库里定位本次压测产生的提交
function buildCode(lang: string, mark?: string) {
  let code = MOCK_CODES[lang];
  if (!code) {
    throw new Error(`不支持的语言: ${lang}（可选 c | cpp | java | pypy3）`);
  }
  if (mark) {
    const prefix = lang === "pypy3" ? `# stress:${mark}\n` : `// stress:${mark}\n`;
    code = prefix + code;
  }
  return code;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.TOTAL_REQUESTS <= 0 || cfg.BATCH_SIZE <= 0) {
    console.error("❌ --total 与 --batch 必须为正数");
    process.exit(1);
  }

  console.log("\n🚀 NovaJudge 判题压力测试");
  console.log(`   题目 ID    : ${cfg.PROBLEM_ID}`);
  console.log(`   提交总数   : ${cfg.TOTAL_REQUESTS}`);
  console.log(`   批次并发   : ${cfg.BATCH_SIZE}`);
  console.log(`   提交语言   : ${cfg.LANGUAGE}`);
  console.log(`   等待结果   : ${cfg.WAIT_FOR_RESULTS ? "是" : "否"}`);
  if (cfg.MARK) console.log(`   提交标记   : ${cfg.MARK}`);
  console.log("");

  // 1. 检查题目是否存在
  const problem = await prisma.problem.findUnique({
    where: { id: cfg.PROBLEM_ID },
  });
  if (!problem) {
    console.error(`❌ 数据库中找不到 ID 为 ${cfg.PROBLEM_ID} 的题目，请修改 --problem 参数。`);
    process.exit(1);
  }
  console.log(`📚 目标题目: #${problem.id} ${problem.title}`);

  // 2. 找一个用户挂靠提交（优先全局管理员，其次普通用户）
  const globalUser = await prisma.globalUser.findFirst();
  const normalUser = await prisma.user.findFirst();
  if (!globalUser && !normalUser) {
    console.error("❌ 数据库没有任何用户，无法创建提交。");
    process.exit(1);
  }
  const actor = globalUser
    ? { kind: "global" as const, id: globalUser.id }
    : { kind: "normal" as const, id: normalUser!.id };
  console.log(`👤 提交挂靠用户: ${actor.kind === "global" ? "globalUser" : "user"} ${actor.id}`);

  // 3. 展示当前在线判题机
  const initialWorkers = await listJudgeWorkers();
  const initialProcessed: Record<string, number> = {};
  if (initialWorkers.length === 0) {
    console.log("⚠️  当前没有在线判题机！提交会一直停在队列里。");
    console.log("   请先启动: npm run worker 或 npm run worker:multi -- N\n");
  } else {
    console.log(`👷 在线判题机 ${initialWorkers.length} 台:`);
    for (const w of initialWorkers) {
      initialProcessed[w.id] = w.processed;
      console.log(`   #${w.id}  ${w.hostname}  PID=${w.pid}  并发=${w.concurrency}  已判=${w.processed}`);
    }
  }

  const code = buildCode(cfg.LANGUAGE, cfg.MARK);
  const submissionIds: string[] = [];
  let failed = 0;

  // 4. 批量循环提交（写库 + 幂等入队）
  const enqueueStart = Date.now();
  for (let i = 0; i < cfg.TOTAL_REQUESTS; i += cfg.BATCH_SIZE) {
    const batchSize = Math.min(cfg.BATCH_SIZE, cfg.TOTAL_REQUESTS - i);
    console.log(`📦 正在推送第 ${i + 1} - ${i + batchSize} 个任务...`);

    const batchPromises = Array.from({ length: batchSize }, async () => {
      // A. 写入数据库（Pending 状态）
      const submission = await prisma.submission.create({
        data: {
          problemId: cfg.PROBLEM_ID,
          ...(actor.kind === "global"
            ? { globalUserId: actor.id }
            : { userId: actor.id }),
          language: cfg.LANGUAGE,
          code,
          codeLength: code.length,
          verdict: Verdict.PENDING,
          displayId: -1,
        },
      });

      // B. 幂等入队（固定 jobId，重复入队不会产生重复任务）
      await enqueueJudge(submission.id);

      return submission.id;
    });

    const results = await Promise.allSettled(batchPromises);
    for (const r of results) {
      if (r.status === "fulfilled") submissionIds.push(r.value);
      else {
        failed += 1;
        console.error(`   ❌ 提交失败: ${(r.reason as Error)?.message ?? r.reason}`);
      }
    }
  }

  const enqueueDuration = Date.now() - enqueueStart;
  console.log(`\n✅ 压测请求发送完毕: 成功 ${submissionIds.length}，失败 ${failed}`);
  console.log(`📊 入队耗时: ${formatDuration(enqueueDuration)}，平均吞吐: ${(submissionIds.length / (enqueueDuration / 1000)).toFixed(2)} 提交/s`);

  if (!cfg.WAIT_FOR_RESULTS) {
    console.log("👉 --no-wait：不等待判题结果，现在可观察判题机控制台输出。");
    await cleanup();
    return;
  }

  // 5. 等待判题完成并统计
  console.log("\n⏳ 等待判题完成...");
  const judgeStart = Date.now();
  let timedOut = false;

  while (true) {
    const group = await prisma.submission.groupBy({
      by: ["verdict"],
      where: { id: { in: submissionIds } },
      _count: { _all: true },
    });
    const finalCount = group
      .filter((g) => FINAL_VERDICTS.has(g.verdict))
      .reduce((sum, g) => sum + g._count._all, 0);

    const queue = (await getJudgeQueueStats()) ?? {};
    const pct = ((finalCount / submissionIds.length) * 100).toFixed(1);
    console.log(`   ⏳ 已判完 ${finalCount}/${submissionIds.length} (${pct}%) | 队列: waiting=${queue.waiting ?? "?"} active=${queue.active ?? "?"} failed=${queue.failed ?? "?"}`);

    if (finalCount >= submissionIds.length) break;
    if (Date.now() - judgeStart > cfg.TIMEOUT_MS) {
      timedOut = true;
      break;
    }
    await sleep(cfg.POLL_INTERVAL_MS);
  }

  if (timedOut) {
    console.log(`\n⏰ 等待超时（${formatDuration(cfg.TIMEOUT_MS)}），仍有提交未判完。`);
    console.log("   请确认判题机已启动、题目数据完整。");
  } else {
    const judgeDuration = Date.now() - judgeStart;
    console.log(`\n✅ 全部 ${submissionIds.length} 个提交判题完成！`);
    console.log(`📊 判题总耗时: ${formatDuration(judgeDuration)}`);
    console.log(`⚡ 判题吞吐: ${(submissionIds.length / (judgeDuration / 1000)).toFixed(2)} 提交/s（平均 ${(judgeDuration / submissionIds.length / 1000).toFixed(2)} s/题）`);

    // 6. 判题结果分布
    const distribution = await prisma.submission.groupBy({
      by: ["verdict"],
      where: { id: { in: submissionIds } },
      _count: { _all: true },
    });
    distribution.sort((a, b) => b._count._all - a._count._all);
    console.log("\n📋 判题结果分布:");
    for (const item of distribution) {
      const pct = ((item._count._all / submissionIds.length) * 100).toFixed(1);
      console.log(`   ${item.verdict.padEnd(24)} ${String(item._count._all).padStart(5)} (${pct}%)`);
    }
  }

  // 7. 每台判题机本次压测的处理量
  const finalWorkers = await listJudgeWorkers();
  if (finalWorkers.length > 0) {
    console.log("\n👷 判题机本次压测处理量:");
    for (const w of finalWorkers) {
      const before = initialProcessed[w.id] ?? 0;
      console.log(`   #${w.id}  已判 ${w.processed}（本次 +${w.processed - before}）`);
    }
  }

  await cleanup();
}

async function cleanup() {
  try {
    await judgeQueue.close();
  } catch {}
  try {
    await redis.quit();
  } catch {}
  try {
    await prisma.$disconnect();
  } catch {}
}

main().catch((e) => {
  console.error("❌", (e as Error)?.message ?? e);
  cleanup().finally(() => process.exit(1));
});
