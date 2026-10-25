import assert from "node:assert/strict";
import test from "node:test";
import {
  runCommunicationCase,
  type CommunicationCommand,
  type CommunicationSandboxResult,
} from "./communication";

const accepted = (stdout = "", overrides: Partial<CommunicationSandboxResult> = {}): CommunicationSandboxResult => ({
  status: "Accepted", exitStatus: 0, time: 600_000_000, memory: 32 * 1024 * 1024,
  files: { stdout }, ...overrides,
});

const rejected = (code: number): CommunicationSandboxResult => accepted("", {
  status: "Nonzero Exit Status", exitStatus: code,
  files: { stderr: "diagnostic" },
});

function harness(results: CommunicationSandboxResult[], captureTrace = false) {
  const commands: CommunicationCommand[] = [];
  const run = runCommunicationCase({
    execute: async ({ cmd }) => {
      assert.equal(cmd.length, 1, "each phase uses a separate sandbox invocation");
      commands.push(cmd[0]);
      const result = results.shift();
      assert.ok(result, "unexpected extra sandbox execution");
      return [result];
    },
    args: ["./main"], env: ["PATH=/usr/bin:/bin"],
    program: { main: { fileId: "solution" } },
    communicatorFileId: "judge", input: "first\nsecret\n", answer: "reference",
    timeLimit: 1_000_000_000, memoryLimit: 128 * 1024 * 1024,
    stackLimit: 128 * 1024 * 1024, captureTrace,
  });
  return { run, commands };
}

test("two fresh runs receive only allowed input; limits and measurements are independent", async () => {
  const { run, commands } = harness([
    accepted("encoded"),
    accepted("second\nencoded", { files: { stdout: "second\nencoded", "state.txt": "private-state" } }),
    accepted("decoded", { time: 700_000_000, memory: 40 * 1024 * 1024 }),
    accepted(),
  ], true);
  const result = await run;
  assert.equal(result.verdict, "ACCEPTED");
  assert.equal(result.timeUsedMs, 700, "1.3 s combined must not become the measured per-run time");
  assert.equal(result.memoryUsedKb, 40 * 1024);
  assert.equal(result.actualOutput, "decoded");
  assert.deepEqual(result.communication, {
    firstOutput: "encoded", secondInput: "second\nencoded",
    firstTimeUsedMs: 600, secondTimeUsedMs: 700,
  });
  assert.deepEqual(commands[0].copyIn, { main: { fileId: "solution" } });
  assert.deepEqual(commands[2].copyIn, commands[0].copyIn);
  assert.equal(commands[0].cpuLimit, commands[2].cpuLimit);
  assert.equal(commands[0].cpuLimit, 1_000_000_000, "CPU budgets must remain unchanged");
  assert.equal(commands[0].clockLimit, commands[2].clockLimit);
  assert.ok(commands[0].clockLimit > commands[0].cpuLimit, "wall time is a separate watchdog");
  assert.equal(commands[0].memoryLimit, commands[2].memoryLimit);
  assert.deepEqual(commands[2].files[0], { content: "second\nencoded" });
  assert.equal(commands[0].copyOut, undefined, "solution working files are never persisted");
  assert.equal(commands[2].copyOut, undefined);
  assert.deepEqual(commands[3].copyIn["state.txt"], { content: "private-state" });
  assert.deepEqual(commands[3].copyIn["first.out"], { content: "encoded" });
  assert.deepEqual(commands[3].copyIn["user.out"], { content: "decoded" });
});

test("normal judging does not return a trace containing private second-run inputs", async () => {
  const { run, commands } = harness([accepted("encoded"), accepted("private data"), accepted("decoded"), accepted()]);
  assert.equal((await run).communication, undefined);
  assert.equal(commands[3].copyIn["state.txt"], undefined, "an absent optional state file must remain absent");
});

test("private communicator diagnostics are only visible in admin sample debugging", async () => {
  const failure = rejected(1);
  failure.files = { stderr: "secret reference answer 392871" };
  const production = await harness([accepted("encoded"), failure]).run;
  assert.doesNotMatch(production.message, /392871/);
  const sample = await harness([accepted("encoded"), failure], true).run;
  assert.match(sample.message, /392871/);
});

test("a solution cannot reveal hidden inputs through its failure stderr", async () => {
  const { run } = harness([accepted("", {
    status: "Nonzero Exit Status", exitStatus: 1, files: { stderr: "hidden input 392871" },
  })]);
  const result = await run;
  assert.equal(result.verdict, "RUNTIME_ERROR");
  assert.doesNotMatch(result.message, /392871/);
});

for (const [exitStatus, verdict] of [[1, "WRONG_ANSWER"], [2, "PRESENTATION_ERROR"], [3, "SYSTEM_ERROR"], [7, "SYSTEM_ERROR"]] as const) {
  test(`prepare exit ${exitStatus} gives ${verdict} and never runs the decoder`, async () => {
    const { run, commands } = harness([accepted("invalid"), rejected(exitStatus)]);
    const result = await run;
    assert.equal(result.verdict, verdict);
    assert.match(result.message, /prepare/);
    assert.equal(commands.length, 2);
  });
}

for (const runNumber of [1, 2] as const) {
  for (const [status, verdict] of [
    ["Time Limit Exceeded", "TIME_LIMIT_EXCEEDED"],
    ["Memory Limit Exceeded", "MEMORY_LIMIT_EXCEEDED"],
    ["Nonzero Exit Status", "RUNTIME_ERROR"],
    ["Output Limit Exceeded", "WRONG_ANSWER"],
    ["Internal Error", "SYSTEM_ERROR"],
  ] as const) {
    test(`run ${runNumber}: ${status} stops judging with ${verdict}`, async () => {
      const prior = runNumber === 1 ? [] : [accepted("encoded"), accepted("second")];
      const { run, commands } = harness([...prior, accepted("", {
        status, exitStatus: 9, time: status === "Time Limit Exceeded" ? 1_100_000_000 : 0,
      })]);
      const result = await run;
      assert.equal(result.verdict, verdict);
      assert.match(result.message, new RegExp(`Run ${runNumber}:`));
      assert.equal(commands.length, runNumber === 1 ? 1 : 3);
    });
  }

  test(`run ${runNumber}: wall-only timeout is a system error with safe diagnostics`, async () => {
    const prior = runNumber === 1 ? [] : [accepted("encoded"), accepted("second")];
    const { run, commands } = harness([...prior, accepted("", {
      status: "Time Limit Exceeded", exitStatus: 9, time: 34_000_000, runTime: 60_100_000_000,
      files: { stderr: "hidden input 392871" },
    })]);
    const result = await run;
    assert.equal(result.verdict, "SYSTEM_ERROR");
    assert.equal(result.timeUsedMs, runNumber === 1 ? 34 : 600);
    assert.match(result.message, new RegExp(`Run ${runNumber}:`));
    assert.match(result.message, /CPU/);
    assert.doesNotMatch(result.message, /392871/);
    assert.equal(commands.length, runNumber === 1 ? 1 : 3);
  });

  test(`run ${runNumber}: completed CPU overrun is still TLE`, async () => {
    const prior = runNumber === 1 ? [] : [accepted("encoded"), accepted("second")];
    const { run, commands } = harness([...prior, accepted("output", { time: 1_100_000_000 })]);
    const result = await run;
    assert.equal(result.verdict, "TIME_LIMIT_EXCEEDED");
    assert.equal(commands.length, runNumber === 1 ? 1 : 3);
  });
}

test("long elapsed time does not penalize either communication run within its CPU budget", async () => {
  const { run } = harness([
    accepted("encoded", { time: 34_000_000, runTime: 13_000_000_000 }),
    accepted("second"),
    accepted("decoded", { time: 60_000_000, runTime: 25_000_000_000 }),
    accepted(),
  ]);
  const result = await run;
  assert.equal(result.verdict, "ACCEPTED");
  assert.equal(result.timeUsedMs, 60);
});

test("judge resource failure is a system error, never a contestant error", async () => {
  const { run } = harness([accepted("encoded"), accepted("", { status: "Time Limit Exceeded", exitStatus: 9 })]);
  assert.equal((await run).verdict, "SYSTEM_ERROR");
});

test("decoder output is decided by check mode rather than by first-run acceptance", async () => {
  const { run } = harness([accepted("encoded"), accepted("second"), accepted("wrong"), rejected(1)]);
  const result = await run;
  assert.equal(result.verdict, "WRONG_ANSWER");
  assert.match(result.message, /check/);
});
