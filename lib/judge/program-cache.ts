import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveJudgeDataPath } from "../problem-judge-config";

type JudgeProgram = "checker" | "interactor" | "communicator";

interface LeaseStore {
  set(key: string, value: string, mode: "PX", ttl: number, condition: "NX"): Promise<"OK" | null>;
  eval(script: string, keyCount: number, ...args: (string | number)[]): Promise<unknown>;
}

interface CompilerOptions {
  judgeUrl: string;
  redis: LeaseStore;
  testlibPath?: string;
  fetch?: typeof fetch;
}

const LEASE_MS = 30_000;
const WAIT_MS = 180_000;
const RENEW_LEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1]) else return 0 end`;

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function readCachedBinary(cachePath: string, fingerprint: string) {
  try {
    const entry = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (entry?.fingerprint !== fingerprint || typeof entry.executable !== "string") return;
    const binary = Buffer.from(entry.executable, "base64");
    if (binary.length && hash(binary) === entry.checksum) return binary;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function saveCachedBinary(cachePath: string, fingerprint: string, binary: Buffer) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({
      fingerprint, checksum: hash(binary), executable: binary.toString("base64"),
    }), { flag: "wx" });
    // One atomic replacement keeps readers from seeing a partially written executable.
    await fs.rename(temporary, cachePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Persist compiled bytes; every caller receives its own disposable go-judge file ID. */
export function createJudgeProgramCompiler(options: CompilerOptions) {
  const judgeUrl = options.judgeUrl.replace(/\/+$/, "");
  const request = options.fetch ?? fetch;
  const pending = new Map<string, Promise<Buffer>>();
  const testlibPath = options.testlibPath ?? path.join(process.cwd(), "lib", "judge", "testlib.h");

  async function deleteFile(fileId: string) {
    try {
      const response = await request(`${judgeUrl}/file/${encodeURIComponent(fileId)}`, {
        method: "DELETE", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok && response.status !== 404) throw new Error(response.statusText);
    } catch (error) {
      console.warn(`Failed to delete compiled judge file ${fileId}`, error);
    }
  }

  async function loadOrCompile(cachePath: string, fingerprint: string, compile: () => Promise<Buffer>) {
    const lockKey = `judge:program:lock:${hash(cachePath)}`;
    const token = randomUUID();
    const deadline = Date.now() + WAIT_MS;
    while (true) {
      const cached = await readCachedBinary(cachePath, fingerprint);
      if (cached) return cached;
      if (await options.redis.set(lockKey, token, "PX", LEASE_MS, "NX") === "OK") break;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for judge program compilation.");
      await delay(100);
    }

    let leaseError: unknown;
    async function renew() {
      if (await options.redis.eval(RENEW_LEASE, 1, lockKey, token, LEASE_MS) !== 1) {
        throw new Error("Judge program compilation lease was lost. Please retry.");
      }
    }
    const heartbeat = setInterval(() => {
      renew().catch((error) => { leaseError = error; });
    }, LEASE_MS / 3);
    heartbeat.unref();
    try {
      // Another worker may have filled the cache just before we acquired the lease.
      const cached = await readCachedBinary(cachePath, fingerprint);
      if (cached) return cached;
      const binary = await compile();
      if (leaseError) throw leaseError;
      await renew();
      await saveCachedBinary(cachePath, fingerprint, binary);
      return binary;
    } finally {
      clearInterval(heartbeat);
      await options.redis.eval(RELEASE_LEASE, 1, lockKey, token).catch((error) => {
        console.warn("Failed to release judge program compilation lease", error);
      });
    }
  }

  return async function compileJudgeProgram(dataDir: string, sourceName: string, binaryName: JudgeProgram = "checker") {
    const sourcePath = resolveJudgeDataPath(dataDir, sourceName);
    const [source, testlib] = await Promise.all([
      fs.readFile(sourcePath, "utf8").catch(() => {
        throw new Error(`${binaryName} file not found: ${sourceName}`);
      }),
      fs.readFile(testlibPath, "utf8").catch(() => {
        throw new Error("System Error: testlib.h not found on server.");
      }),
    ]);
    const command = {
      args: ["/usr/bin/g++", `${binaryName}.cpp`, "-o", binaryName, "-O2", "-std=c++23"],
      env: ["PATH=/usr/bin:/bin"],
      files: [
        { content: "" },
        { name: "stdout", max: 1000000 },
        { name: "stderr", max: 1000000 },
      ],
      cpuLimit: 10_000_000_000,
      clockLimit: 30_000_000_000,
      memoryLimit: 1024 * 1024 * 1024,
      procLimit: 50,
      copyIn: { [`${binaryName}.cpp`]: { content: source }, "testlib.h": { content: testlib } },
      copyOut: ["stdout", "stderr"],
      copyOutCached: [binaryName],
    };
    // Hash the actual compilation inputs, not timestamps: same-size edits and ZIP replacements count.
    const fingerprint = hash(JSON.stringify([1, sourcePath, command]));
    const cachePath = path.join(path.resolve(dataDir, ".."), ".judge-cache", `${binaryName}-${hash(judgeUrl)}.json`);
    const pendingKey = `${cachePath}:${fingerprint}`;
    let compilation = pending.get(pendingKey);
    if (!compilation) {
      compilation = loadOrCompile(cachePath, fingerprint, async () => {
        const response = await request(`${judgeUrl}/run`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: [command] }), signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`Judge Server Error: ${response.statusText}`);
        const [result] = await response.json();
        const fileId = result?.fileIds?.[binaryName];
        try {
          if (result?.status !== "Accepted") {
            const fileError = Array.isArray(result?.fileError)
              ? result.fileError.map((item: { message?: string }) => item.message).filter(Boolean).join("; ") : "";
            throw new Error(result?.files?.stderr || fileError || result?.files?.stdout || `${binaryName} compile failed`);
          }
          if (!fileId) throw new Error(`${binaryName} compilation produced no executable.`);
          const download = await request(`${judgeUrl}/file/${encodeURIComponent(fileId)}`, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!download.ok) throw new Error(`Failed to download compiled ${binaryName}: ${download.statusText}`);
          const binary = Buffer.from(await download.arrayBuffer());
          if (!binary.length) throw new Error(`${binaryName} compilation produced an empty executable.`);
          return binary;
        } finally {
          if (fileId) await deleteFile(fileId);
        }
      });
      pending.set(pendingKey, compilation);
    }

    let binary: Buffer;
    try {
      binary = await compilation;
    } finally {
      if (pending.get(pendingKey) === compilation) pending.delete(pendingKey);
    }
    // Submission-owned IDs preserve existing cleanup and survive go-judge restarts between submissions.
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(binary)]), binaryName);
    const upload = await request(`${judgeUrl}/file`, {
      method: "POST", body: form, signal: AbortSignal.timeout(30_000),
    });
    if (!upload.ok) throw new Error(`Failed to upload compiled ${binaryName}: ${upload.statusText}`);
    const fileId: unknown = await upload.json();
    if (typeof fileId !== "string" || !fileId) throw new Error(`Invalid compiled ${binaryName} file ID.`);
    return fileId;
  };
}
