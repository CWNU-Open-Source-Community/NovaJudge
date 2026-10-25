const MILLISECOND = 1_000_000;
const DEFAULT_WALL_WATCHDOG_MS = 60_000;

export interface RunTimeLimits {
  cpuLimit: number;
  clockLimit: number;
}

interface SandboxTiming {
  status: string;
  time?: number;
  runTime?: number;
}

/** Wall time is an infrastructure watchdog, never the contestant's time budget. */
export function getRunTimeLimits(
  cpuLimit: number,
  watchdogMs: string | number = process.env.JUDGE_WALL_WATCHDOG_MS || DEFAULT_WALL_WATCHDOG_MS,
): RunTimeLimits {
  const minimumWallMs = Number(watchdogMs);
  const clockLimit = Math.ceil(Math.max(minimumWallMs * MILLISECOND, 20 * cpuLimit));
  if (!Number.isFinite(cpuLimit) || cpuLimit <= 0 ||
      !Number.isFinite(minimumWallMs) || minimumWallMs <= 0 ||
      !Number.isSafeInteger(clockLimit)) {
    throw new Error("Invalid judge CPU limit or JUDGE_WALL_WATCHDOG_MS.");
  }
  return { cpuLimit, clockLimit };
}

function milliseconds(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value / MILLISECOND).toFixed(3)} ms`
    : "unknown";
}

/** go-judge uses the same TLE status for CPU and elapsed-time expiration. */
export function getTimeLimitFailure(
  result: SandboxTiming,
  limits: RunTimeLimits,
): { verdict: "TIME_LIMIT_EXCEEDED" | "SYSTEM_ERROR"; message: string } | undefined {
  if (result.status !== "Time Limit Exceeded" && result.status !== "Accepted") return;
  const exceededCpu = typeof result.time === "number" &&
    Number.isFinite(result.time) && result.time > limits.cpuLimit;
  if (!exceededCpu && result.status === "Accepted") return;

  const timing = `CPU ${milliseconds(result.time)} / ${milliseconds(limits.cpuLimit)}; ` +
    `elapsed ${milliseconds(result.runTime)} / watchdog ${milliseconds(limits.clockLimit)}`;
  if (exceededCpu) {
    return { verdict: "TIME_LIMIT_EXCEEDED", message: `CPU time limit exceeded (${timing}).` };
  }
  return {
    verdict: "SYSTEM_ERROR",
    message: `Execution stopped without exceeding the CPU time limit (${timing}). Please rejudge or check the judge server.`,
  };
}
