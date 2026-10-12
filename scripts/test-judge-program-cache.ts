/** Real go-judge/Redis checks using temporary fixtures; never accesses the database. */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Redis from "ioredis";
import { createJudgeProgramCompiler } from "../lib/judge/program-cache";

const executeFile = promisify(execFile);
const judgeUrl = (process.env.GO_JUDGE_API || "http://localhost:5050").replace(/\/+$/, "");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true,
});
type ProgramKind = "checker" | "interactor" | "communicator";
let compiles = 0;
const countedFetch: typeof fetch = async (input, init) => {
  if (String(input) === `${judgeUrl}/run`) compiles++;
  return fetch(input, init);
};

async function run() {
  if (process.argv[2] === "--compile") {
    const [, , , dataDir, testlibPath, kind] = process.argv;
    const compile = createJudgeProgramCompiler({ judgeUrl, redis, testlibPath, fetch: countedFetch });
    const id = await compile(dataDir, "judge.cpp", kind as ProgramKind);
    console.log(JSON.stringify({ id, compiles }));
    return;
  }

  await redis.ping();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge-cache-integration-"));
  const dataDir = path.join(root, "data");
  const testlibPath = path.join(root, "testlib.h");
  const sourcePath = path.join(dataDir, "judge.cpp");
  const fileIds = new Set<string>();

  async function checkOutput(id: string, kind: ProgramKind, expected: string) {
    const response = await fetch(`${judgeUrl}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: [{
        args: [`./${kind}`], env: ["PATH=/usr/bin:/bin"],
        files: [{ content: "" }, { name: "stdout", max: 1024 }, { name: "stderr", max: 1024 }],
        cpuLimit: 1_000_000_000, clockLimit: 3_000_000_000,
        memoryLimit: 128 * 1024 * 1024, procLimit: 10,
        copyIn: { [kind]: { fileId: id } },
      }] }), signal: AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok);
    const [result] = await response.json();
    assert.equal(result.status, "Accepted", JSON.stringify(result));
    assert.equal(result.files?.stdout, expected);
  }

  async function removeFile(id: string) {
    const response = await fetch(`${judgeUrl}/file/${encodeURIComponent(id)}`, {
      method: "DELETE", signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok || response.status === 404, `Could not remove fixture executable ${id}`);
    fileIds.delete(id);
  }

  try {
    await fs.mkdir(dataDir);
    const testlib = await fs.readFile(path.join(process.cwd(), "lib", "judge", "testlib.h"), "utf8");
    await fs.writeFile(testlibPath, `${testlib}\n#define CACHE_VALUE 1\n`);
    await fs.writeFile(sourcePath, '#include "testlib.h"\nint main() { disableFinalizeGuard(); std::cout << CACHE_VALUE << "v1"; }\n');
    const compile = createJudgeProgramCompiler({ judgeUrl, redis, testlibPath, fetch: countedFetch });
    const getProgram = async (kind: ProgramKind) => {
      const id = await compile(dataDir, "judge.cpp", kind);
      fileIds.add(id);
      return id;
    };

    // Independent Node processes exercise the real distributed lease and on-disk publication.
    const children = await Promise.allSettled(Array.from({ length: 3 }, async () => {
      const { stdout } = await executeFile(process.execPath, [
        "--import", "tsx", path.join(process.cwd(), "scripts", "test-judge-program-cache.ts"),
        "--compile", dataDir, testlibPath, "checker",
      ], { timeout: 180_000, windowsHide: true });
      const result = JSON.parse(stdout.trim()) as { id: string; compiles: number };
      fileIds.add(result.id);
      return result;
    }));
    const results = children.map((child) => {
      if (child.status === "rejected") throw child.reason;
      return child.value;
    });
    assert.equal(results.reduce((sum, result) => sum + result.compiles, 0), 1);
    assert.equal(new Set(results.map(({ id }) => id)).size, 3);
    await Promise.all(results.map(({ id }) => checkOutput(id, "checker", "1v1")));
    console.log("PASS: three worker processes share one checker compilation and run independent executables.");

    const first = results[0].id;
    await removeFile(results[1].id);
    await removeFile(results[2].id);
    await checkOutput(await getProgram("checker"), "checker", "1v1");
    assert.equal(compiles, 0);
    for (const kind of ["interactor", "communicator"] as const) {
      const before: number = compiles;
      await checkOutput(await getProgram(kind), kind, "1v1");
      await checkOutput(await getProgram(kind), kind, "1v1");
      assert.equal(compiles - before, 1);
    }
    console.log("PASS: checker, interactor and communicator reuse the compiled bytes after submission cleanup.");

    const stat = await fs.stat(sourcePath);
    await fs.writeFile(sourcePath, '#include "testlib.h"\nint main() { disableFinalizeGuard(); std::cout << CACHE_VALUE << "v2"; }\n');
    await fs.utimes(sourcePath, stat.atime, stat.mtime);
    const beforeSource: number = compiles;
    await checkOutput(await getProgram("checker"), "checker", "1v2");
    await checkOutput(await getProgram("checker"), "checker", "1v2");
    assert.equal(compiles - beforeSource, 1);
    await checkOutput(first, "checker", "1v1");
    await fs.writeFile(testlibPath, `${testlib}\n#define CACHE_VALUE 2\n`);
    const beforeHeader: number = compiles;
    await checkOutput(await getProgram("checker"), "checker", "2v2");
    assert.equal(compiles - beforeHeader, 1);
    console.log("PASS: source/header edits recompile; active submissions retain their original binary.");
    console.log("All judge program cache integration checks passed; no database access.");
  } finally {
    await Promise.all([...fileIds].map(removeFile));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => redis.disconnect());
