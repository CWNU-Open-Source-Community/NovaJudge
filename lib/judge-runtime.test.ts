import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { Verdict } from "./generated/prisma/enums";
import * as timing from "./judge/runtime-limits";
import type { DebugAllSamplesResult } from "./judge";

const SECOND = 1_000_000_000;
interface SandboxResult {
  status: string;
  time?: number;
  runTime?: number;
  memory: number;
  exitStatus: number;
  files?: Record<string, string>;
  fileIds?: Record<string, string>;
}
interface Command {
  args: string[];
  cpuLimit: number;
  clockLimit: number;
}
interface SubmissionUpdate {
  verdict: string;
  timeUsed?: number;
  passedTests?: number;
  errorMessage?: string;
}

const accepted = (overrides: Partial<SandboxResult> = {}): SandboxResult => ({
  status: "Accepted", time: 34_000_000, runTime: 1_300_000_000,
  memory: 32 * 1024 * 1024, exitStatus: 0, files: { stdout: "ok\n" }, ...overrides,
});
const timeout = (time: number | undefined = 34_000_000) => accepted({
  status: "Time Limit Exceeded", time, runTime: 61 * SECOND, exitStatus: 9,
  files: { stdout: "incomplete output", stderr: "untrusted diagnostic" },
});

const filename = "lib/judge.ts";
const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function harness(type: "standard" | "spj" | "interactive", responses: SandboxResult[][], language = "pypy3") {
  const requests: { cmd: Command[] }[] = [];
  const updates: SubmissionUpdate[] = [];
  const diagnostics: unknown[][] = [];
  const progress: Record<string, unknown>[] = [];
  const problem = {
    id: 42, type, defaultTimeLimit: 1000, defaultMemoryLimit: 128,
    judgeConfig: {
      cases: [{ input: "input.in", output: "answer.out" }],
      checker: "checker.cpp", interactor: "interactor.cpp",
    },
    samples: [{ input: "input\n", output: "ok\n" }],
  };
  const dependencies: Record<string, unknown> = {
    "path": path,
    "fs": { promises: { readFile: async (name: string) => name.endsWith("answer.out") ? "ok\n" : "input\n" } },
    "@/lib/prisma": { prisma: { submission: {
      findUnique: async () => ({ id: "fixture", code: "print('ok')", language, problem }),
      update: async ({ data }: { data: SubmissionUpdate }) => { updates.push(structuredClone(data)); },
    } } },
    "@/lib/redis": { redis: {
      set: async (_key: string, value: string) => { progress.push(JSON.parse(value)); },
      del: async () => 1,
    } },
    "@/lib/generated/prisma/enums": { Verdict },
    "@/lib/problem-judge-config": { resolveJudgeDataPath: path.join },
    "./judge/program-cache": { createJudgeProgramCompiler: () => async () => "judge-fixture-file" },
    "./judge/runtime-limits": { ...timing, getRunTimeLimits: (cpu: number) => timing.getRunTimeLimits(cpu, 60_000) },
    "./judge/communication": {},
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
    process: { env: {}, cwd: () => process.cwd() },
    AbortSignal,
    console: { error: (...args: unknown[]) => diagnostics.push(args), warn: (...args: unknown[]) => diagnostics.push(args) },
    fetch: async (_url: string, options: { method: string; body?: string }) => {
      if (options.method === "DELETE") return { ok: true };
      requests.push(JSON.parse(options.body!));
      const result = responses.shift();
      assert.ok(result, "Unexpected additional sandbox invocation");
      return { ok: true, json: async () => result };
    },
  }, { filename });
  const judge = exports as {
    judgeSubmission(id: string): Promise<void>;
    debugProblemSamples(problem: unknown, code: string, language: string): Promise<DebugAllSamplesResult>;
  };
  return {
    requests, updates, diagnostics, progress,
    run: async () => {
      await judge.judgeSubmission("fixture");
      assert.equal(responses.length, 0, "All expected sandbox responses must be used");
      return updates.at(-1)!;
    },
    sample: async () => {
      const result = await judge.debugProblemSamples(problem, "print('ok')", language);
      assert.equal(responses.length, 0, "All expected sandbox responses must be used");
      return result;
    },
  };
}

for (const type of ["standard", "spj"] as const) {
  for (const scenario of [
    { name: "wall timeout with low CPU", result: timeout(), verdict: "SYSTEM_ERROR", sample: "SE" },
    { name: "CPU limit exceeded", result: timeout(SECOND + 1), verdict: "TIME_LIMIT_EXCEEDED", sample: "TLE" },
    { name: "accepted status with excess CPU", result: accepted({ time: SECOND + 1 }), verdict: "TIME_LIMIT_EXCEEDED", sample: "TLE" },
  ]) {
    test(`${type}: ${scenario.name} stops formal judging before output checking`, async () => {
      const h = harness(type, [[scenario.result]]);
      const final = await h.run();
      assert.equal(final.verdict, scenario.verdict);
      assert.equal(final.passedTests, 0);
      assert.equal(final.timeUsed, Math.floor(scenario.result.time! / 1_000_000));
      assert.equal(h.requests.length, 1, "SPJ must not run after an interrupted solution");
      assert.equal(h.requests[0].cmd[0].cpuLimit, SECOND);
      assert.equal(h.requests[0].cmd[0].clockLimit, 60 * SECOND);
      assert.match(final.errorMessage!, /CPU.*elapsed/);
      assert.equal(h.progress.at(-1)!.finished, true);
    });

    test(`${type} sample: ${scenario.name} has the same verdict policy`, async () => {
      const h = harness(type, [[scenario.result]]);
      const result = await h.sample();
      assert.equal(result.compile.ok, true);
      assert.equal(result.results[0].verdict, scenario.sample);
      assert.equal(result.summary.passed, 0);
      assert.equal(h.requests.length, 1);
      assert.equal(h.requests[0].cmd[0].cpuLimit, SECOND);
      assert.equal(h.requests[0].cmd[0].clockLimit, 60 * SECOND);
    });
  }

  for (const mode of ["run", "sample"] as const) {
    test(`${type} ${mode}: correct output still passes when elapsed time exceeds the CPU budget`, async () => {
      const h = harness(type, [[accepted({ runTime: 30 * SECOND })], ...(type === "spj" ? [[accepted()]] : [])]);
      if (mode === "run") {
        const result = await h.run();
        assert.equal(result.verdict, "ACCEPTED");
        assert.equal(result.timeUsed, 34);
        assert.equal(result.passedTests, 1);
      } else {
        const result = await h.sample();
        assert.equal(result.results[0].verdict, "AC");
        assert.equal(result.results[0].timeUsedMs, 34);
        assert.equal(result.summary.passed, 1);
      }
    });
  }
}

for (const [name, user, interactor, verdict] of [
  ["wall-only timeout", timeout(), accepted(), "SYSTEM_ERROR"],
  ["real CPU timeout", timeout(SECOND + 1), accepted(), "TIME_LIMIT_EXCEEDED"],
  ["wall timeout with judge rejection", timeout(), accepted({ status: "Nonzero Exit Status", exitStatus: 1 }), "SYSTEM_ERROR"],
  ["CPU timeout takes priority over judge failure", timeout(SECOND + 1), timeout(), "TIME_LIMIT_EXCEEDED"],
  ["cancelled solution after interactor timeout", accepted({ status: "Signalled", exitStatus: 9 }), timeout(), "SYSTEM_ERROR"],
  ["cancelled solution after interactor failure", accepted({ status: "Signalled", exitStatus: 9 }), accepted({ status: "Internal Error", exitStatus: 1 }), "SYSTEM_ERROR"],
  ["long elapsed successful interaction", accepted({ runTime: 30 * SECOND }), accepted(), "ACCEPTED"],
  ["ordinary interactor rejection", accepted(), accepted({ status: "Nonzero Exit Status", exitStatus: 1 }), "WRONG_ANSWER"],
] as const) {
  test(`interactive: ${name}`, async () => {
    const h = harness("interactive", [[user, interactor]]);
    assert.equal((await h.run()).verdict, verdict);
    const [solutionCommand, judgeCommand] = h.requests[0].cmd;
    assert.equal(solutionCommand.cpuLimit, SECOND);
    assert.equal(solutionCommand.clockLimit, 60 * SECOND);
    assert.ok(judgeCommand.clockLimit >= solutionCommand.clockLimit);
  });
}

for (const mode of ["run", "sample"] as const) {
  test(`SPJ ${mode}: checker timeout is system error rather than wrong answer`, async () => {
    const h = harness("spj", [[accepted()], [timeout()]]);
    if (mode === "run") assert.equal((await h.run()).verdict, "SYSTEM_ERROR");
    else assert.equal((await h.sample()).results[0].verdict, "SE");
  });
}

test("compiler wall-only timeout is a system error rather than compilation failure", async () => {
  const h = harness("standard", [[timeout()]], "cpp");
  assert.equal((await h.run()).verdict, "SYSTEM_ERROR");
  assert.equal(h.requests.length, 1, "The contestant executable must not run after interrupted compilation");
});
