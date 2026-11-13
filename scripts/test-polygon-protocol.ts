/** Compiles author-created Polygon fixtures and exercises real stdio/tout/checker chains.
 * Default: go-judge integration (no database). POLYGON_TEST_CXX: local compiler/process
 * smoke test only; this mode does not validate sandbox security or resource accounting.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { polygonProtocolFixture } from "../tests/fixtures/polygon";
import { parsePolygonProblems } from "../lib/polygon-archive";
import type { ProblemJudgeConfig } from "../lib/problem-judge-config";
import { runPolygonCase, type PolygonRequest } from "../lib/judge/polygon";
import type { CommunicationSandboxResult } from "../lib/judge/communication";

const localCompiler = process.env.POLYGON_TEST_CXX;
const judgeUrl = (process.env.GO_JUDGE_API || "http://localhost:5050").replace(/\/+$/, "");
const fileIds = new Set<string>();
let temporaryRoot = "";
type SandboxResult = CommunicationSandboxResult & { fileIds?: Record<string, string> };

async function remoteExecute(request: PolygonRequest): Promise<SandboxResult[]> {
  const response = await fetch(`${judgeUrl}/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(Math.ceil(Math.max(...request.cmd.map((cmd) => cmd.clockLimit)) / 1_000_000) + 60_000),
  });
  if (!response.ok) throw new Error(`go-judge HTTP ${response.status}: ${await response.text()}`);
  const results: SandboxResult[] = await response.json();
  for (const result of results) for (const id of Object.values(result.fileIds || {})) fileIds.add(id);
  return results;
}

/** Only executes the trusted fixtures below, in fresh temporary directories. */
async function localExecute(request: PolygonRequest): Promise<SandboxResult[]> {
  const directories = await Promise.all(request.cmd.map(async (cmd) => {
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "run-"));
    for (const [name, file] of Object.entries(cmd.copyIn)) {
      if ("content" in file) await fs.writeFile(path.join(directory, name), file.content);
      else await fs.copyFile(file.fileId, path.join(directory, name + (process.platform === "win32" ? ".exe" : "")));
    }
    return directory;
  }));
  const children = request.cmd.map((cmd, index) => spawn(
    path.join(directories[index], cmd.args[0]) + (process.platform === "win32" ? ".exe" : ""), cmd.args.slice(1),
    { cwd: directories[index], windowsHide: true, stdio: "pipe", timeout: 10_000 },
  ));
  const results = children.map((child, index) => new Promise<SandboxResult>((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      (async () => {
        const files: Record<string, string> = { stdout, stderr };
        for (const name of request.cmd[index].copyOut || []) files[name] = await fs.readFile(path.join(directories[index], name), "utf8");
        resolve({ status: signal ? "Signalled" : code === 0 ? "Accepted" : "Nonzero Exit Status", exitStatus: code ?? 9, time: 0, memory: 0, files });
      })().catch(reject);
    });
  }));
  for (const pipe of request.pipeMapping || []) children[pipe.in.index].stdout.pipe(children[pipe.out.index].stdin);
  request.cmd.forEach((cmd, index) => {
    const input = cmd.files[0];
    if (input && "content" in input) children[index].stdin.end(input.content);
  });
  return Promise.all(results);
}

async function compile(source: string, testlib: string): Promise<string> {
  if (localCompiler) {
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "compile-"));
    await fs.writeFile(path.join(directory, "program.cpp"), source);
    await fs.writeFile(path.join(directory, "testlib.h"), testlib);
    const executable = path.join(directory, process.platform === "win32" ? "program.exe" : "program");
    await promisify(execFile)(localCompiler, ["-std=c++17", "-O2", "program.cpp", "-o", executable], {
      cwd: directory, windowsHide: true, timeout: 60_000,
    });
    return executable;
  }
  const command = {
    args: ["/usr/bin/g++", "-std=c++23", "-O2", "program.cpp", "-o", "program"], env: ["PATH=/usr/bin:/bin"],
    files: [{ content: "" }, { name: "stdout", max: 65536 }, { name: "stderr", max: 65536 }],
    cpuLimit: 20_000_000_000, clockLimit: 60_000_000_000, memoryLimit: 512 * 1024 * 1024, procLimit: 50,
    copyIn: { "program.cpp": { content: source }, "testlib.h": { content: testlib } }, copyOutCached: ["program"],
  };
  const [result] = await remoteExecute({ cmd: [command] });
  assert.equal(result.status, "Accepted", result.files?.stderr);
  assert.ok(result.fileIds?.program);
  return result.fileIds.program;
}

const solution = `#include <iostream>
#include <fstream>
#include <string>
int main(int argc, char** argv) {
  for (auto name : {"input.in", "answer.out", "tout.txt", "first-run-only.txt"})
    if (std::ifstream(name).good()) return 17;
  int phase, value;
  if (!(std::cin >> phase >> value)) return 18;
  std::string mode = argc > 1 ? argv[1] : "";
  if (phase == 1 && (mode == "large-dialogue" || mode == "large-wrong")) {
    int chunks;
    std::cin >> chunks;
    for (int i = 0; i < chunks; ++i) {
      std::string payload;
      std::cin >> payload;
      std::cout << payload << std::endl;
    }
  }
  if (phase == 1) std::ofstream("first-run-only.txt") << "must not reach run two";
  int output = phase == 1 ? value + 1 : value * 2;
  if (mode == "wrong" || mode == "large-wrong") ++output;
  if (mode == "reject-first" || (mode == "reject-second" && phase == 2)) output = -1;
  if (phase == 1 && mode == "plain") std::cout << "2 ";
  std::cout << output << std::endl;
}`;
const checker = `#include "testlib.h"
int main(int argc, char** argv) {
  registerTestlibCmd(argc, argv);
  if (inf.readInt() != 1) quitf(_fail, "Expected ORIGINAL input");
  int expected = ans.readInt(), actual = ouf.readInt();
  if (expected != actual) quitf(_wa, "Final result differs");
  quitf(_ok, "Correct final result");
}`;
const interactor = `#include "testlib.h"
int main(int argc, char** argv) {
  registerInteraction(argc, argv);
  int phase = inf.readInt(), value = inf.readInt();
  int runs = phase == 1 ? inf.readInt() : 2;
  int chunks = phase == 1 && !inf.seekEof() ? inf.readInt() : 0;
  if (ans.readInt() <= 0) quitf(_fail, "Missing reference answer");
  std::cout << phase << " " << value << std::endl;
  if (chunks) {
    std::cout << chunks << std::endl;
    std::string payload(65536, 'x');
    for (int i = 0; i < chunks; ++i) {
      std::cout << payload << std::endl;
      if (ouf.readToken() != payload) quitf(_wa, "Dialogue changed or truncated");
    }
  }
  int message = ouf.readInt();
  if (message < 0) quitf(_wa, "Illegal message");
  if (phase == 1 && runs == 2) tout << "2 ";
  tout << message << std::endl;
  quitf(_ok, "Valid interaction, final checker still required");
}`;

async function main() {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge-polygon-"));
  const testlib = await fs.readFile(path.join(process.cwd(), "lib/judge/testlib.h"), "utf8");
  const programId = await compile(solution, testlib);
  for (const [runCount, runs] of [[1, [1]], [2, []], [2, [1]], [2, [1, 2]]] as const) {
    const zip = polygonProtocolFixture(runCount, [...runs]);
    zip.file("files/check.cpp", checker);
    if (runs.length) zip.file("files/interactor.cpp", interactor);
    zip.file("tests/01", `1 6 ${runCount}\n`);
    zip.file("tests/01.a", runCount === 1 ? "7\n" : "14\n");
    const [{ archive }] = await parsePolygonProblems(zip);
    const config = archive.data.judgeConfig as unknown as ProblemJudgeConfig;
    const checkerId = await compile(archive.files.get("data/checker.cpp")!.toString(), testlib);
    const interactorId = runs.length ? await compile(archive.files.get("data/interactor.cpp")!.toString(), testlib) : undefined;
    for (const mode of runs.length ? ["correct", "wrong", "reject-first", ...(runs.length === 2 ? ["reject-second"] : []), "large-dialogue", "large-wrong"] : ["plain"]) {
      let calls = 0;
      const result = await runPolygonCase({
        execute: async (request) => { calls++; return localCompiler ? localExecute(request) : remoteExecute(request); },
        args: ["./main", mode], env: ["PATH=/usr/bin:/bin"], program: { main: { fileId: programId } },
        checkerFileId: checkerId, interactorFileId: interactorId,
        // 300 x 64 KiB in EACH direction exceeds the old 10/16 MiB transcript caps.
        input: mode.startsWith("large-") ? `1 6 ${runCount} 300\n` : archive.files.get("data/001.in")!.toString(),
        answer: archive.files.get("data/001.out")!.toString(),
        timeLimit: 1_000_000_000, memoryLimit: 256 * 1024 * 1024, stackLimit: 64 * 1024 * 1024,
        polygon: config.polygon!, communication: config.communication, captureTrace: true,
      });
      assert.equal(result.verdict, ["plain", "correct", "large-dialogue"].includes(mode) ? "ACCEPTED" : "WRONG_ANSWER", result.message);
      if (mode.startsWith("large-")) {
        const preview = runCount === 1 ? result.actualOutput : result.communication!.firstOutput;
        assert.match(preview, /\[Interactive transcript truncated\]$/);
        assert.ok(Buffer.byteLength(preview) < 66 * 1024);
      }
      assert.equal(calls, mode === "reject-first" ? 1 : mode === "reject-second" ? 2 : runCount + 1);
      console.log(`PASS runs=${runCount}, interaction=[${runs}], mode=${mode}: ${result.verdict}`);
    }
  }
  console.log(localCompiler ? "Local C++ protocol smoke tests passed (resource isolation requires go-judge integration)." : "Polygon go-judge integration passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const id of fileIds) await fetch(`${judgeUrl}/file/${encodeURIComponent(id)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => {});
  // Only remove the directory created by mkdtemp above, never an environment-provided path.
  if (temporaryRoot && path.dirname(temporaryRoot) === path.resolve(os.tmpdir()) && path.basename(temporaryRoot).startsWith("novajudge-polygon-")) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
