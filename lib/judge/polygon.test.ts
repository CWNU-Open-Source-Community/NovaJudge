import assert from "node:assert/strict";
import test from "node:test";
import { runPolygonCase, type PolygonCaseOptions, type PolygonRequest } from "./polygon";
import type { CommunicationSandboxResult } from "./communication";

const accepted = (stdout = "", overrides: Partial<CommunicationSandboxResult> = {}): CommunicationSandboxResult => ({
  status: "Accepted", exitStatus: 0, time: 600_000_000, memory: 32 * 1024 * 1024, files: { stdout }, ...overrides,
});
const interactor = (tout: string) => accepted("visible input", { files: { stdout: "visible input", "tout.txt": tout } });
const rejected = (exitStatus: number) => accepted("", {
  status: "Nonzero Exit Status", exitStatus, files: { stderr: "private answer 392871" },
});

function harness(responses: CommunicationSandboxResult[][], overrides: Partial<PolygonCaseOptions> = {}) {
  const requests: PolygonRequest[] = [];
  const run = runPolygonCase({
    args: ["./main"], env: ["PATH=/usr/bin:/bin"], program: { main: { fileId: "solution" } },
    checkerFileId: "checker", interactorFileId: "interactor", input: "private original input", answer: "private answer",
    timeLimit: 1_000_000_000, memoryLimit: 128 * 1024 * 1024, stackLimit: 128 * 1024 * 1024,
    polygon: { run_count: 2, interactor_runs: [] },
    execute: async (request) => {
      requests.push(request);
      const response = responses.shift();
      assert.ok(response, "Unexpected extra sandbox invocation");
      return response;
    },
    ...overrides,
  });
  return { requests, run: async () => {
    const result = await run;
    assert.equal(responses.length, 0, "All expected stages must execute");
    return result;
  } };
}

test("plain run-twice forwards stdout, uses fresh sandboxes and independent limits, then checks final output", async () => {
  const h = harness([[accepted("message")], [accepted("decoded", { time: 700_000_000, memory: 40 * 1024 * 1024 })], [accepted()]], { captureTrace: true });
  const result = await h.run();
  assert.equal(result.verdict, "ACCEPTED");
  assert.equal(result.timeUsedMs, 700);
  assert.equal(result.memoryUsedKb, 40 * 1024);
  assert.deepEqual(result.communication, { firstOutput: "message", secondInput: "message", firstTimeUsedMs: 600, secondTimeUsedMs: 700 });
  const [first, second, checker] = h.requests.map((request) => request.cmd[0]);
  assert.deepEqual(first.files[0], { content: "private original input" });
  assert.deepEqual(second.files[0], { content: "message" });
  assert.deepEqual(first.copyIn, { main: { fileId: "solution" } });
  assert.deepEqual(second.copyIn, first.copyIn);
  assert.equal(second.copyOut, undefined);
  assert.equal(first.cpuLimit, second.cpuLimit);
  assert.equal(first.clockLimit, second.clockLimit);
  assert.equal(first.memoryLimit, second.memoryLimit);
  assert.equal(first.cpuLimit, 1_000_000_000);
  assert.deepEqual(checker.copyIn["input.in"], { content: "private original input" });
  assert.deepEqual(checker.copyIn["user.out"], { content: "decoded" });
  assert.deepEqual(checker.copyIn["answer.out"], { content: "private answer" });
});

test("interactive first run forwards tout, not the solution stdout or interactor stdout", async () => {
  const h = harness([[accepted("encoded"), interactor("prepared second input")], [accepted("decoded")], [accepted()]], {
    polygon: { run_count: 2, interactor_runs: [1] },
  });
  const result = await h.run();
  assert.equal(result.verdict, "ACCEPTED");
  assert.equal(result.communication, undefined);
  assert.deepEqual(h.requests[1].cmd[0].files[0], { content: "prepared second input" });
  assert.deepEqual(h.requests[0].cmd[1].args, ["./interactor", "input.in", "tout.txt", "answer.out"]);
  assert.deepEqual(h.requests[0].cmd[1].copyIn["answer.out"], { content: "private answer" });
  assert.equal(h.requests[0].cmd[0].files[0], null);
  assert.equal(h.requests[0].cmd[0].copyIn["input.in"], undefined);
  assert.equal(h.requests[0].pipeMapping?.length, 2);
  assert.ok(h.requests[0].cmd[1].clockLimit >= h.requests[0].cmd[0].clockLimit);
});

test("both interactive invocations chain interactor inputs and give final tout to the checker", async () => {
  const h = harness([[accepted("first dialogue"), interactor("private second input")],
    [accepted("second dialogue"), interactor("final result")], [accepted()]], {
    polygon: { run_count: 2, interactor_runs: [1, 2] }, captureTrace: true,
  });
  const result = await h.run();
  assert.equal(result.verdict, "ACCEPTED");
  assert.equal(result.actualOutput, "second dialogue");
  assert.equal(result.communication?.secondInput, "visible input", "trace shows solution stdin, not private interactor input");
  assert.deepEqual(h.requests[1].cmd[1].copyIn["input.in"], { content: "private second input" });
  assert.deepEqual(h.requests[1].cmd[0].copyIn, { main: { fileId: "solution" } });
  assert.deepEqual(h.requests[2].cmd[0].copyIn["user.out"], { content: "final result" });
  assert.deepEqual(h.requests[2].cmd[0].copyIn["input.in"], { content: "private original input" });
});

test("an accepted single interaction can still fail its final checker", async () => {
  const h = harness([[accepted("dialogue"), interactor("wrong result")], [rejected(1)]], {
    polygon: { run_count: 1, interactor_runs: [1] },
  });
  const result = await h.run();
  assert.equal(result.verdict, "WRONG_ANSWER");
  assert.match(result.message, /Polygon checker/);
  assert.doesNotMatch(result.message, /392871/);
  assert.deepEqual(h.requests[1].cmd[0].copyIn["user.out"], { content: "wrong result" });
});

for (const [code, verdict] of [[1, "WRONG_ANSWER"], [2, "PRESENTATION_ERROR"], [3, "SYSTEM_ERROR"], [8, "WRONG_ANSWER"], [7, "SYSTEM_ERROR"]] as const) {
  test(`interactor exit ${code} stops before the next round/checker with ${verdict}`, async () => {
    const h = harness([[accepted("", { status: "Signalled", exitStatus: 13 }), rejected(code)]], {
      polygon: { run_count: 2, interactor_runs: [1] },
    });
    const result = await h.run();
    assert.equal(result.verdict, verdict);
    assert.doesNotMatch(result.message, /392871/);
    assert.equal(h.requests.length, 1);
  });
}

for (const run of [1, 2]) {
  for (const [status, time, verdict] of [
    ["Time Limit Exceeded", 1_100_000_000, "TIME_LIMIT_EXCEEDED"],
    ["Accepted", 1_100_000_000, "TIME_LIMIT_EXCEEDED"],
    ["Time Limit Exceeded", 34_000_000, "SYSTEM_ERROR"],
    ["Memory Limit Exceeded", 0, "MEMORY_LIMIT_EXCEEDED"],
    ["Output Limit Exceeded", 0, "WRONG_ANSWER"],
    ["Nonzero Exit Status", 0, "RUNTIME_ERROR"],
    ["Internal Error", 0, "SYSTEM_ERROR"],
  ] as const) {
    test(`round ${run} ${status}, CPU ${time}: ${verdict} stops subsequent phases`, async () => {
      const h = harness([...(run === 2 ? [[accepted("bridge")]] : []), [accepted("", {
        status, time, exitStatus: 9, runTime: 61_000_000_000, files: { stderr: "private answer 392871" },
      })]]);
      const result = await h.run();
      assert.equal(result.verdict, verdict);
      assert.match(result.message, new RegExp(`Run ${run}:`));
      assert.doesNotMatch(result.message, /392871/);
      assert.equal(h.requests.length, run);
    });
  }
}

test("missing tout and broken judge processes are system errors, not accepted empty output", async () => {
  for (const judge of [accepted(), accepted("", { status: "Time Limit Exceeded" }), accepted("", { status: "File Error" })]) {
    const result = await harness([[accepted(), judge]], { polygon: { run_count: 1, interactor_runs: [1] } }).run();
    assert.equal(result.verdict, "SYSTEM_ERROR");
  }
  await assert.rejects(harness([[]]).run(), /Incomplete Polygon judge response/);
});

test("empty tout is valid and diagnostics are available only for the admin debugger", async () => {
  const result = await harness([[accepted(), interactor("")], [rejected(2)]], {
    polygon: { run_count: 1, interactor_runs: [1] }, captureTrace: true,
  }).run();
  assert.equal(result.verdict, "PRESENTATION_ERROR");
  assert.match(result.message, /392871/);
});

test("ordinary output still respects the configured communication limit", async () => {
  const h = harness([[accepted("12345")]], {
    polygon: { run_count: 2, interactor_runs: [] }, communication: { output_limit: 4 },
  });
  const result = await h.run();
  assert.equal(result.verdict, "WRONG_ANSWER");
  assert.match(result.message, /exceeds 4 bytes/);
  assert.deepEqual(h.requests[0].cmd[0].files[1], { name: "stdout", max: 4 });
});

for (const runCount of [1, 2] as const) {
  test(`a ${runCount}-run interaction caps diagnostic previews without limiting the dialogue or truncating tout`, async () => {
    const dialogue = "x".repeat(64 * 1024 + 1);
    const tout = "t".repeat(70 * 1024);
    const h = harness([
      [accepted(dialogue), accepted("", { files: { stdout: dialogue, "tout.txt": tout } })],
      ...(runCount === 2 ? [[accepted("12\n")]] : []),
      [accepted()],
    ], { polygon: { run_count: runCount, interactor_runs: [1] }, communication: { output_limit: 4 }, captureTrace: true });
    const result = await h.run();
    assert.equal(result.verdict, "ACCEPTED");
    const preview = runCount === 1 ? result.actualOutput : result.communication!.firstOutput;
    assert.equal(preview, "x".repeat(64 * 1024) + "\n[Interactive transcript truncated]");
    assert.ok(h.requests[0].pipeMapping!.every(pipe => pipe.max === 64 * 1024 + 1));
    if (runCount === 2) {
      assert.deepEqual(h.requests[1].cmd[0].files[0], { content: tout });
      assert.deepEqual(h.requests[2].cmd[0].copyIn["user.out"], { content: "12\n" });
    } else {
      assert.deepEqual(h.requests[1].cmd[0].copyIn["user.out"], { content: tout });
    }
  });
}

test("a long dialogue still obeys an interactor rejection", async () => {
  const result = await harness([[accepted("x".repeat(64 * 1024 + 1)), rejected(1)]], {
    polygon: { run_count: 1, interactor_runs: [1] },
  }).run();
  assert.equal(result.verdict, "WRONG_ANSWER");
  assert.equal(result.message, "Interactor run 1: WRONG_ANSWER");
});
