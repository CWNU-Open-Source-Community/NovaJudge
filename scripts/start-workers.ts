/**
 * 一键多开判题机。
 *
 * 用法：
 *   npm run worker:multi -- 4              # 开启 4 台判题机（ID 由 Redis 全局分配）
 *   JUDGE_WORKER_COUNT=3 npm run worker:multi
 *   JUDGE_WORKER_IDS=1,2,5 npm run worker:multi   # 指定具体 ID 列表
 *
 * 每台判题机都是独立的 Node 进程，共享同一个 Redis 判题队列；BullMQ
 * 保证任务不会重复领取。子进程异常退出后会按指数退避自动拉起。
 */
import { spawn, type ChildProcess } from "child_process";
import path from "path";

function resolveWorkerIds(): Array<string | undefined> {
  // 1. 优先使用 JUDGE_WORKER_IDS 显式指定的 ID 列表
  const envIds = (process.env.JUDGE_WORKER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envIds.length > 0) return [...new Set(envIds)];

  // 2. 否则使用命令行参数或 JUDGE_WORKER_COUNT 的数量，默认 2 台
  const raw = Number(process.argv[2] || process.env.JUDGE_WORKER_COUNT || 2);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
  // 不显式传 ID，让 worker.ts 使用「hostname + Redis 序号」全局分配；
  // 这样多台主机同时多开也不会互相覆盖心跳。
  return Array.from({ length: count }, () => undefined);
}

const workerScript = path.join(process.cwd(), "worker.ts");

interface WorkerSlot {
  index: number;
  requestedId?: string;
  child?: ChildProcess;
  startedAt?: number;
  restartCount: number;
  restartTimer?: NodeJS.Timeout;
}

let shuttingDown = false;

function slotLabel(slot: WorkerSlot) {
  return slot.requestedId || `auto-${slot.index}`;
}

function startWorker(slot: WorkerSlot) {
  const label = slotLabel(slot);
  console.log(`🟢 Starting judge worker slot #${label}...`);

  const args = ["--import", "tsx", workerScript];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (slot.requestedId) {
    args.push("--id", slot.requestedId);
    env.JUDGE_ID = slot.requestedId;
  } else {
    // worker:multi must not accidentally reuse one JUDGE_ID for every child.
    delete env.JUDGE_ID;
  }

  // 使用 node --import tsx 运行 TypeScript 入口，跨平台且不依赖全局安装
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });
  slot.child = child;
  slot.startedAt = Date.now();

  child.once("error", (err) => {
    console.error(`❌ Failed to start judge worker slot #${label}: ${err.message}`);
    console.error("   请确认已安装依赖（node_modules 中存在 tsx）。");
  });

  child.once("close", (code, signal) => {
    console.log(
      `🔴 Judge worker slot #${label} exited (code=${code}, signal=${signal}).`,
    );
    if (slot.child === child) slot.child = undefined;
    if (shuttingDown) return;

    const uptime = Date.now() - (slot.startedAt ?? Date.now());
    slot.restartCount = uptime >= 60_000 ? 1 : slot.restartCount + 1;
    const delayMs = Math.min(
      1000 * 2 ** Math.min(slot.restartCount - 1, 5),
      30_000,
    );
    console.error(
      `🟠 Restarting worker slot #${label} in ${Math.ceil(delayMs / 1000)}s...`,
    );
    slot.restartTimer = setTimeout(() => {
      slot.restartTimer = undefined;
      startWorker(slot);
    }, delayMs);
  });
}

const slots: WorkerSlot[] = resolveWorkerIds().map((requestedId, index) => ({
  index: index + 1,
  requestedId,
  restartCount: 0,
}));
console.log(
  `👷 Launching ${slots.length} judge worker(s): ${slots
    .map(slotLabel)
    .join(", ")}`,
);
console.log("   按 Ctrl+C 停止全部判题机。");

for (const slot of slots) startWorker(slot);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n⏹️  Stopping all judge workers...");
  for (const slot of slots) {
    if (slot.restartTimer) clearTimeout(slot.restartTimer);
    const child = slot.child;
    if (!child) continue;
    if (!child.killed) child.kill("SIGTERM");
  }
  // 给子进程一点时间优雅退出（注销心跳、完成当前任务）
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
