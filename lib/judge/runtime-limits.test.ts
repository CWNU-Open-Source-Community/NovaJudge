import assert from "node:assert/strict";
import test from "node:test";
import { getRunTimeLimits, getTimeLimitFailure } from "./runtime-limits";

const SECOND = 1_000_000_000;
const limits = getRunTimeLimits(SECOND, 60_000);

test("wall watchdog leaves the CPU budget unchanged and scales for long problems", () => {
  assert.deepEqual(limits, { cpuLimit: SECOND, clockLimit: 60 * SECOND });
  assert.deepEqual(getRunTimeLimits(10 * SECOND, 60_000), {
    cpuLimit: 10 * SECOND, clockLimit: 200 * SECOND,
  });
  assert.deepEqual(getRunTimeLimits(SECOND, "120000"), {
    cpuLimit: SECOND, clockLimit: 120 * SECOND,
  });
});

test("invalid CPU or watchdog configuration fails before sandbox execution", () => {
  for (const cpu of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => getRunTimeLimits(cpu, 60_000), /Invalid judge/);
  }
  for (const watchdog of [0, -1, NaN, Infinity, "bad", "", Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => getRunTimeLimits(SECOND, watchdog), /Invalid judge/);
  }
});

test("elapsed time alone never turns a completed program into TLE", () => {
  assert.equal(getTimeLimitFailure({ status: "Accepted", time: 34_000_000, runTime: 30 * SECOND }, limits), undefined);
  assert.equal(getTimeLimitFailure({ status: "Accepted", time: SECOND }, limits), undefined);
});

test("only measured CPU above the limit produces TLE, even for a completed process", () => {
  for (const status of ["Accepted", "Time Limit Exceeded"]) {
    const result = getTimeLimitFailure({ status, time: SECOND + 1, runTime: 2 * SECOND }, limits);
    assert.equal(result?.verdict, "TIME_LIMIT_EXCEEDED");
    assert.match(result!.message, /CPU time limit exceeded/);
  }
});

test("wall expiration, exact-boundary CPU and missing measurements are system failures", () => {
  for (const time of [34_000_000, SECOND, undefined, NaN, Infinity]) {
    const result = getTimeLimitFailure({ status: "Time Limit Exceeded", time, runTime: 61 * SECOND }, limits);
    assert.equal(result?.verdict, "SYSTEM_ERROR");
    assert.match(result!.message, /elapsed 61000\.000 ms/);
    assert.match(result!.message, /watchdog 60000\.000 ms/);
  }
});

test("memory, output and runtime failures keep their own verdict classification", () => {
  for (const status of ["Memory Limit Exceeded", "Output Limit Exceeded", "Nonzero Exit Status", "Internal Error", "Signalled"]) {
    assert.equal(getTimeLimitFailure({ status, time: 2 * SECOND }, limits), undefined);
  }
});
