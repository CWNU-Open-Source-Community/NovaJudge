/** Real go-judge checks using disposable programs; no database or submission changes. */
import "dotenv/config";
import assert from "node:assert/strict";
import { getRunTimeLimits, getTimeLimitFailure, type RunTimeLimits } from "../lib/judge/runtime-limits";

const judgeUrl = (process.env.GO_JUDGE_API || "http://localhost:5050").replace(/\/+$/, "");
const SECOND = 1_000_000_000;

async function run(source: string, limits: RunTimeLimits) {
  const response = await fetch(`${judgeUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(Math.ceil(limits.clockLimit / 1_000_000) + 60_000),
    body: JSON.stringify({ cmd: [{
      args: ["/usr/bin/pypy3", "main.py"],
      env: ["PATH=/usr/bin:/bin", "LANG=en_US.UTF-8"],
      files: [{ content: "" }, { name: "stdout", max: 4096 }, { name: "stderr", max: 4096 }],
      ...limits,
      memoryLimit: 256 * 1024 * 1024,
      procLimit: 50,
      copyIn: { "main.py": { content: source } },
    }] }),
  });
  assert.ok(response.ok, `go-judge HTTP ${response.status}`);
  const [result] = await response.json();
  assert.ok(result, "Missing go-judge result");
  return result;
}

async function main() {
  const limits = getRunTimeLimits(SECOND);
  const waiting = await run("import time\ntime.sleep(1.3)\nprint('ok')\n", limits);
  assert.equal(waiting.status, "Accepted");
  assert.equal(waiting.files?.stdout?.trim(), "ok");
  assert.ok(waiting.time < limits.cpuLimit);
  assert.ok(waiting.runTime > limits.cpuLimit);
  assert.equal(getTimeLimitFailure(waiting, limits), undefined);
  console.log(`PASS waiting: CPU ${(waiting.time / 1_000_000).toFixed(1)} ms, elapsed ${(waiting.runTime / 1_000_000).toFixed(1)} ms, Accepted`);

  const busy = await run("while True:\n    pass\n", limits);
  assert.equal(busy.status, "Time Limit Exceeded");
  assert.equal(getTimeLimitFailure(busy, limits)?.verdict, "TIME_LIMIT_EXCEEDED");
  console.log(`PASS CPU loop: ${(busy.time / 1_000_000).toFixed(1)} ms, TLE`);

  // Shorten only this fixture's watchdog so the cleanup/error path can be tested quickly.
  const shortWatchdog = { cpuLimit: SECOND, clockLimit: SECOND / 2 };
  const blocked = await run("import time\ntime.sleep(10)\n", shortWatchdog);
  assert.equal(blocked.status, "Time Limit Exceeded");
  assert.ok(blocked.time < shortWatchdog.cpuLimit);
  assert.equal(getTimeLimitFailure(blocked, shortWatchdog)?.verdict, "SYSTEM_ERROR");
  console.log(`PASS watchdog: CPU ${(blocked.time / 1_000_000).toFixed(1)} ms, elapsed ${(blocked.runTime / 1_000_000).toFixed(1)} ms, SYSTEM_ERROR`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
