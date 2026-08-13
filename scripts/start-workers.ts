/**
 * 一键多开判题机。
 *
 * 用法：
 *   npm run worker:multi -- 4              # 开启 4 台判题机（ID 依次为 1-4）
 *   JUDGE_WORKER_COUNT=3 npm run worker:multi
 *   JUDGE_WORKER_IDS=1,2,5 npm run worker:multi   # 指定具体 ID 列表
 *
 * 每台判题机都是独立的 Node 进程（node --import tsx worker.ts --id <ID>），
 * 共享同一个 Redis 判题队列；BullMQ 保证任务不会重复领取。
 */
import { spawn, type ChildProcess } from "child_process";
import path from "path";

function resolveIds(): string[] {
  // 1. 优先使用 JUDGE_WORKER_IDS 显式指定的 ID 列表
  const envIds = (process.env.JUDGE_WORKER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envIds.length > 0) return envIds;

  // 2. 否则使用命令行参数或 JUDGE_WORKER_COUNT 的数量，默认 2 台
  const raw = Number(process.argv[2] || process.env.JUDGE_WORKER_COUNT || 2);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

const workerScript = path.join(process.cwd(), "worker.ts");

const children: ChildProcess[] = [];

function startWorker(id: string) {
  console.log(`🟢 Starting judge worker #${id}...`);
  // 使用 node --import tsx 运行 TypeScript 入口，跨平台且不依赖全局安装
  const child = spawn(
    process.execPath,
    ["--import", "tsx", workerScript, "--id", id],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, JUDGE_ID: id },
    },
  );

  children.push(child);

  child.on("exit", (code, signal) => {
    console.log(`🔴 Judge worker #${id} exited (code=${code}, signal=${signal}).`);
    const idx = children.indexOf(child);
    if (idx >= 0) children.splice(idx, 1);
  });

  child.on("error", (err) => {
    console.error(`❌ Failed to start judge worker #${id}: ${err.message}`);
    console.error("   请确认已安装依赖（node_modules 中存在 tsx）。");
  });
}

const ids = resolveIds();
console.log(`👷 Launching ${ids.length} judge worker(s): ${ids.join(", ")}`);
console.log("   按 Ctrl+C 停止全部判题机。");

for (const id of ids) startWorker(id);

function shutdown() {
  console.log("\n⏹️  Stopping all judge workers...");
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  // 给子进程一点时间优雅退出（注销心跳、完成当前任务）
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
