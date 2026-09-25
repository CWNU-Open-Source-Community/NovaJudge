import assert from "node:assert/strict";
import test from "node:test";
import { parseJudgeWorkerInfo, type JudgeWorkerInfo } from "./worker-info";

const worker: JudgeWorkerInfo = {
  id: "host-2", pid: 123, hostname: "host", platform: "win32",
  concurrency: 4, startedAt: 1_700_000_000_000, lastHeartbeat: 1_700_000_005_000,
  processed: 3, activeJobs: [{ jobId: "judge-sub-1", submissionId: "1" }],
  judgeApi: "http://localhost:5050",
};

test("accepts valid worker heartbeat records including active jobs", () => {
  assert.deepEqual(parseJudgeWorkerInfo(JSON.stringify(worker)), worker);
  const idle = { ...worker, activeJobs: [] };
  assert.deepEqual(parseJudgeWorkerInfo(JSON.stringify(idle)), idle);
});

test("ignores the worker ID counter alongside live heartbeat records", () => {
  const records = ["2", JSON.stringify(worker)].map(parseJudgeWorkerInfo).filter((info) => info !== null);
  records.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  assert.deepEqual(records, [worker]);
});

test("ignores expired keys, malformed JSON and JSON primitives", () => {
  for (const raw of [null, "", "{", "null", "false", '"worker"', "[]", "{}"]) {
    assert.equal(parseJudgeWorkerInfo(raw), null, `unexpected record: ${raw}`);
  }
});

test("rejects invalid IDs and missing or nonnumeric heartbeat timestamps", () => {
  for (const id of [undefined, null, 2, "", " "]) {
    assert.equal(parseJudgeWorkerInfo(JSON.stringify({ ...worker, id })), null);
  }
  for (const lastHeartbeat of [undefined, null, "1700000005000"]) {
    assert.equal(parseJudgeWorkerInfo(JSON.stringify({ ...worker, lastHeartbeat })), null);
  }
  assert.equal(parseJudgeWorkerInfo(JSON.stringify(worker).replace('"lastHeartbeat":1700000005000', '"lastHeartbeat":1e999')), null);
});

test("rejects malformed display fields and active jobs before they reach the dashboard", () => {
  for (const patch of [
    { hostname: {} }, { platform: null }, { judgeApi: 3 }, { pid: "123" },
    { concurrency: null }, { processed: {} }, { startedAt: undefined },
    { activeJobs: null }, { activeJobs: {} }, { activeJobs: [null] },
    { activeJobs: [{ jobId: "1", submissionId: 123 }] },
  ]) {
    assert.equal(parseJudgeWorkerInfo(JSON.stringify({ ...worker, ...patch })), null);
  }
});
