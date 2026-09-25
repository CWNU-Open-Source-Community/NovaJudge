/** End-to-end communication checks against go-judge; never reads or writes the database. */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  runCommunicationCase,
  type CommunicationCommand,
  type CommunicationResult,
  type CommunicationSandboxResult,
  type CommunicationVerdict,
} from "../lib/judge/communication";

const judgeUrl = (process.env.GO_JUDGE_API || "http://localhost:5050").replace(/\/+$/, "");
const workspace = process.cwd();
const exampleDir = path.join(workspace, "examples/communication/encode-decode");
const createdFileIds = new Set<string>();
const SECOND = 1_000_000_000;

type SandboxResult = CommunicationSandboxResult & { fileIds?: Record<string, string> };

async function execute(request: { cmd: CommunicationCommand[] }): Promise<SandboxResult[]> {
  const response = await fetch(`${judgeUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`go-judge returned HTTP ${response.status}: ${await response.text()}`);
  const results: SandboxResult[] = await response.json();
  assert.ok(Array.isArray(results), "go-judge did not return a results array");
  for (const result of results) {
    for (const fileId of Object.values(result.fileIds || {})) createdFileIds.add(fileId);
  }
  return results;
}

async function compile(
  name: string,
  source: string,
  testlib: string,
): Promise<string> {
  const command: CommunicationCommand & { copyOutCached: string[] } = {
    args: ["/usr/bin/g++", "-std=c++23", "-O2", "program.cpp", "-o", "program"],
    env: ["PATH=/usr/bin:/bin"],
    files: [{ content: "" }, { name: "stdout", max: 65536 }, { name: "stderr", max: 65536 }],
    cpuLimit: 20 * SECOND,
    clockLimit: 30 * SECOND,
    memoryLimit: 512 * 1024 * 1024,
    procLimit: 50,
    copyIn: { "program.cpp": { content: source }, "testlib.h": { content: testlib } },
    copyOutCached: ["program"],
  };
  const [result] = await execute({ cmd: [command] });
  assert.equal(result?.status, "Accepted", `${name} compilation failed: ${result?.files?.stderr}`);
  assert.ok(result.fileIds?.program, `${name} compilation did not return a program`);
  return result.fileIds.program;
}

function replaceOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length, 2, `Fixture marker must occur once: ${before}`);
  return source.replace(before, after);
}

interface CaseOptions {
  name: string;
  programId: string;
  communicatorId: string;
  input: string;
  expected: CommunicationVerdict | CommunicationVerdict[];
  expectedCalls: number;
  scenario?: string;
  timeLimit?: number;
  outputLimit?: number;
  verify?: (result: CommunicationResult) => void;
}

async function checkCase(options: CaseOptions): Promise<void> {
  let calls = 0;
  const result = await runCommunicationCase({
    execute: async (request) => {
      calls++;
      return execute(request);
    },
    args: ["./program", ...(options.scenario ? [options.scenario] : [])],
    env: ["PATH=/usr/bin:/bin"],
    program: { program: { fileId: options.programId } },
    communicatorFileId: options.communicatorId,
    input: options.input,
    answer: "",
    timeLimit: options.timeLimit ?? SECOND,
    memoryLimit: 256 * 1024 * 1024,
    stackLimit: 64 * 1024 * 1024,
    config: { output_limit: options.outputLimit ?? 1048576 },
    captureTrace: true,
  });
  const expected = Array.isArray(options.expected) ? options.expected : [options.expected];
  assert.ok(expected.includes(result.verdict), `${options.name}: expected ${expected.join("/")}, got ${result.verdict}: ${result.message}`);
  assert.equal(calls, options.expectedCalls, `${options.name}: wrong number of stages; a failed stage must stop execution`);
  options.verify?.(result);
  console.log(`PASS ${options.name}: ${result.verdict}`);
}

async function main(): Promise<void> {
  const [testlib, communicatorSource, solutionSource, wrongSource, firstInput, secondInput] = await Promise.all([
    readFile(path.join(workspace, "lib/judge/testlib.h"), "utf8"),
    readFile(path.join(exampleDir, "communicator.cpp"), "utf8"),
    readFile(path.join(exampleDir, "solution.cpp"), "utf8"),
    readFile(path.join(exampleDir, "wrong.cpp"), "utf8"),
    readFile(path.join(exampleDir, "1.in"), "utf8"),
    readFile(path.join(exampleDir, "2.in"), "utf8"),
  ]);

  // Preserve the fixture's actual encoding/decoding while injecting failure modes.
  const phaseMarker = "if (!(std::cin >> phase)) return 1;";
  const behaviorSource = `#include <fstream>\n#include <ctime>\nstatic int remembered = 0;\n${replaceOnce(
    replaceOnce(solutionSource, "int main()", "int main(int argc, char* argv[])"),
    phaseMarker,
    `${phaseMarker}
    const std::string scenario = argc > 1 ? argv[1] : "";
    if ((scenario == "re-first" && phase == "first") ||
        (scenario == "re-second" && phase == "second")) return 17;
    if ((scenario == "tle-first" && phase == "first") ||
        (scenario == "tle-second" && phase == "second")) {
        volatile unsigned long long work = 1;
        for (;;) work = work * 1664525 + 1013904223;
    }
    if (scenario == "malformed" && phase == "first") {
        std::cout << "NOT_LOWERCASE\\n";
        return 0;
    }
    if (scenario == "overflow" && phase == "first") {
        std::cout << std::string(4096, 'a') << '\\n';
        return 0;
    }
    if (scenario == "isolation" || scenario == "state") {
        if (phase == "first") {
            remembered = 314159;
            std::ofstream leak("first-run-only.txt");
            if (!leak) return 18;
            leak << "must not reach run two";
        } else {
            if (remembered != 0) return 19;
            for (const char* name : {"first-run-only.txt", "input.in", "answer.out",
                                     "first.out", "second.in", "state.txt"}) {
                if (std::ifstream(name).good()) return 20;
            }
        }
    }
    if (scenario == "cpu-budget") {
        const std::clock_t start = std::clock();
        volatile unsigned long long work = 1;
        while (std::clock() - start < CLOCKS_PER_SEC * 0.6) {
            work = work * 1664525 + 1013904223;
        }
    }`,
  )}`;

  const prepareMarker = 'if (mode == "prepare") {';
  const failedCommunicatorSource = replaceOnce(
    communicatorSource,
    prepareMarker,
    `${prepareMarker}\n        quitf(_fail, "Deliberate judge failure");`,
  );
  const stateCommunicatorSource = `#include <fstream>\n${replaceOnce(
    replaceOnce(
      communicatorSource,
      prepareMarker,
      `${prepareMarker}
        std::ofstream state("state.txt");
        state << "judge-only-state";
        state.close();
        if (!state) quitf(_fail, "Could not save state");`,
    ),
    'if (mode == "check") {',
    `if (mode == "check") {
        std::ifstream state("state.txt");
        std::string saved;
        state >> saved;
        if (saved != "judge-only-state") quitf(_fail, "Private state was not delivered");
        std::ifstream firstOutput("first.out"), secondInput("second.in");
        std::string encoded, phase, forwarded;
        firstOutput >> encoded;
        secondInput >> phase >> forwarded;
        if (encoded.empty() || phase != "second" || encoded != forwarded) {
            quitf(_fail, "Judge stage files were not delivered correctly");
        }`,
  )}`;

  const communicatorId = await compile("communicator", communicatorSource, testlib);
  const solutionId = await compile("solution", solutionSource, testlib);
  const wrongId = await compile("wrong", wrongSource, testlib);
  const behaviorId = await compile("behavior cases", behaviorSource, testlib);
  const failedCommunicatorId = await compile("failing communicator", failedCommunicatorSource, testlib);
  const stateCommunicatorId = await compile("stateful communicator", stateCommunicatorSource, testlib);
  const common = { communicatorId, input: firstInput };
  const cases: CaseOptions[] = [
    { ...common, name: "correct C++ / 1.in", programId: solutionId, expected: "ACCEPTED", expectedCalls: 4 },
    { ...common, name: "correct C++ / 2.in", input: secondInput, programId: solutionId, expected: "ACCEPTED", expectedCalls: 4 },
    { ...common, name: "wrong decoded array", programId: wrongId, expected: "WRONG_ANSWER", expectedCalls: 4 },
    { ...common, name: "invalid first message", programId: behaviorId, scenario: "malformed", expected: ["WRONG_ANSWER", "PRESENTATION_ERROR"], expectedCalls: 2 },
    { ...common, name: "fresh memory and files", programId: behaviorId, scenario: "isolation", expected: "ACCEPTED", expectedCalls: 4 },
    { ...common, name: "first run RE", programId: behaviorId, scenario: "re-first", expected: "RUNTIME_ERROR", expectedCalls: 1 },
    { ...common, name: "second run RE", programId: behaviorId, scenario: "re-second", expected: "RUNTIME_ERROR", expectedCalls: 3 },
    { ...common, name: "first run CPU timeout", programId: behaviorId, scenario: "tle-first", timeLimit: 100_000_000, expected: "TIME_LIMIT_EXCEEDED", expectedCalls: 1 },
    { ...common, name: "second run CPU timeout", programId: behaviorId, scenario: "tle-second", timeLimit: 100_000_000, expected: "TIME_LIMIT_EXCEEDED", expectedCalls: 3 },
    { ...common, name: "communicator _fail is SE", programId: solutionId, communicatorId: failedCommunicatorId, expected: "SYSTEM_ERROR", expectedCalls: 2 },
    { ...common, name: "first stdout byte limit", programId: behaviorId, scenario: "overflow", outputLimit: 32, expected: "WRONG_ANSWER", expectedCalls: 1 },
    { ...common, name: "private state reaches only checker", programId: behaviorId, communicatorId: stateCommunicatorId, scenario: "state", expected: "ACCEPTED", expectedCalls: 4 },
    {
      ...common,
      name: "independent 1-second CPU budgets",
      programId: behaviorId,
      scenario: "cpu-budget",
      expected: "ACCEPTED",
      expectedCalls: 4,
      verify: (result) => {
        const trace = result.communication;
        assert.ok(trace, "Expected sample trace for timing verification");
        const times = [trace.firstTimeUsedMs, trace.secondTimeUsedMs];
        assert.ok(times.every((time) => time >= 500 && time < 1000), `Each run must consume real CPU time below 1 second: ${times}`);
        assert.ok(times[0] + times[1] > 1000, `Combined CPU time must exceed one run's budget: ${times}`);
        assert.equal(result.timeUsedMs, Math.max(...times), "Reported time must be the maximum run time, not the sum");
        console.log(`  CPU used: ${times[0]} ms + ${times[1]} ms; reported maximum ${result.timeUsedMs} ms`);
      },
    },
  ];

  for (const testCase of cases) await checkCase(testCase);
  console.log(`\n${cases.length} communication checks passed using real go-judge sandboxes; no database access.`);
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    let removed = 0;
    for (const fileId of createdFileIds) {
      try {
        const response = await fetch(`${judgeUrl}/file/${encodeURIComponent(fileId)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(10_000),
        });
        assert.ok(response.ok || response.status === 404, `Cleanup HTTP ${response.status}`);
        removed++;
      } catch (error) {
        console.error(`Could not clean this script's cached file ${fileId}:`, error);
        process.exitCode = 1;
      }
    }
    console.log(`Cleaned ${removed}/${createdFileIds.size} compilation files created by this script.`);
  }
}

void run();
