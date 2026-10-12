import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJudgeProgramCompiler } from "./program-cache";

class MemoryLeases {
  values = new Map<string, { token: string; expires: number }>();
  async set(key: string, token: string, _mode: "PX", ttl: number, _condition: "NX") {
    assert.equal(_condition, "NX");
    if ((this.values.get(key)?.expires ?? 0) > Date.now()) return null;
    this.values.set(key, { token, expires: Date.now() + ttl });
    return "OK" as const;
  }
  async eval(_script: string, _keyCount: number, ...args: (string | number)[]) {
    const [key, token, ttl] = args;
    const entry = this.values.get(String(key));
    if (!entry || entry.token !== token || entry.expires <= Date.now()) return 0;
    if (ttl) entry.expires = Date.now() + Number(ttl);
    else this.values.delete(String(key));
    return 1;
  }
}

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge-cache-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, "data");
  const sourcePath = path.join(dataDir, "judge.cpp");
  const testlibPath = path.join(root, "testlib.h");
  await fs.mkdir(dataDir);
  await fs.writeFile(sourcePath, "source-v1");
  await fs.writeFile(testlibPath, "header-v1");
  const files = new Map<string, Buffer>();
  const redis = new MemoryLeases();
  let serial = 0;
  const state = {
    compiles: 0, uploads: 0, failCompile: false, missingExecutable: false,
    failDownload: false, failUpload: false,
  };
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/run") {
      state.compiles++;
      await delay(10);
      const { cmd: [command] } = JSON.parse(String(init?.body));
      if (state.failCompile) return Response.json([{ status: "Nonzero Exit Status", files: { stderr: "syntax error" } }]);
      if (state.missingExecutable) return Response.json([{ status: "Accepted", fileIds: {} }]);
      const name = command.copyOutCached[0];
      const id = `compiled-${++serial}`;
      // Include non-text bytes to catch accidental UTF-8 round trips of the executable.
      files.set(id, Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from(JSON.stringify(command.copyIn))]));
      return Response.json([{ status: "Accepted", fileIds: { [name]: id } }]);
    }
    if (url.pathname === "/file" && init?.method === "POST") {
      if (state.failUpload) return new Response(null, { status: 503, statusText: "Unavailable" });
      state.uploads++;
      const blob = (init.body as FormData).get("file") as Blob;
      assert.ok(blob instanceof Blob);
      const id = `uploaded-${++serial}`;
      files.set(id, Buffer.from(await blob.arrayBuffer()));
      return Response.json(id);
    }
    const id = decodeURIComponent(url.pathname.slice("/file/".length));
    if (init?.method === "DELETE") {
      files.delete(id);
      return new Response(null, { status: 200 });
    }
    if (state.failDownload) return new Response(null, { status: 503, statusText: "Unavailable" });
    const file = files.get(id);
    return file ? new Response(new Uint8Array(file)) : new Response(null, { status: 404 });
  };
  const compiler = (judgeUrl = "http://judge:5050") => createJudgeProgramCompiler({
    judgeUrl, redis, fetch: request, testlibPath,
  });
  const cacheFile = async () => {
    const dir = path.join(root, ".judge-cache");
    return path.join(dir, (await fs.readdir(dir))[0]);
  };
  return { dataDir, sourcePath, testlibPath, compiler, state, files, redis, cacheFile };
}

for (const kind of ["checker", "interactor", "communicator"] as const) {
  test(`${kind}: sequential submissions and a new worker reuse the persisted binary`, async (t) => {
    const f = await fixture(t);
    const compile = f.compiler();
    const first = await compile(f.dataDir, "judge.cpp", kind);
    const bytes = f.files.get(first);
    f.files.delete(first); // Existing submission cleanup must not invalidate the binary cache.
    const second = await compile(f.dataDir, "judge.cpp", kind);
    const third = await f.compiler("http://judge:5050/")(f.dataDir, "judge.cpp", kind);
    assert.equal(f.state.compiles, 1);
    assert.equal(f.state.uploads, 3);
    assert.notEqual(second, third);
    assert.deepEqual(f.files.get(second), bytes);
    assert.deepEqual(f.files.get(third), bytes);
    assert.equal(f.files.size, 2, "the original compilation file is cleaned up");
    assert.equal(f.redis.values.size, 0);
  });
}

test("concurrent workers compile a source once and own independent execution files", async (t) => {
  const f = await fixture(t);
  const workers = [f.compiler(), f.compiler(), f.compiler()];
  const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => workers[i % 3](f.dataDir, "judge.cpp")));
  assert.equal(f.state.compiles, 1);
  assert.equal(new Set(ids).size, 12);
  assert.equal(f.files.size, 12);
  f.files.delete(ids[0]);
  assert.ok(ids.slice(1).every((id) => f.files.has(id)));
});

test("same-size source edits with preserved timestamps invalidate the cache", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  const first = await compile(f.dataDir, "judge.cpp");
  const oldBytes = f.files.get(first);
  const stat = await fs.stat(f.sourcePath);
  await fs.writeFile(f.sourcePath, "source-v2");
  await fs.utimes(f.sourcePath, stat.atime, stat.mtime);
  const second = await compile(f.dataDir, "judge.cpp");
  await compile(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 2);
  assert.notDeepEqual(f.files.get(second), oldBytes);
  assert.deepEqual(f.files.get(first), oldBytes, "already running submissions keep their own version");
});

test("header updates and selecting another source file both recompile", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  const first = await compile(f.dataDir, "judge.cpp");
  await fs.writeFile(f.testlibPath, "header-v2");
  const second = await compile(f.dataDir, "judge.cpp");
  assert.notDeepEqual(f.files.get(first), f.files.get(second));
  await fs.copyFile(f.sourcePath, path.join(f.dataDir, "replacement.cpp"));
  await compile(f.dataDir, "replacement.cpp");
  assert.equal(f.state.compiles, 3);
});

test("a backend restart restores cached bytes without compilation", async (t) => {
  const f = await fixture(t);
  const first = await f.compiler()(f.dataDir, "judge.cpp");
  const bytes = f.files.get(first);
  f.files.clear();
  const second = await f.compiler()(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 1);
  assert.deepEqual(f.files.get(second), bytes);
});

test("backend and program roles have separate caches", async (t) => {
  const f = await fixture(t);
  await f.compiler()(f.dataDir, "judge.cpp", "checker");
  await f.compiler()(f.dataDir, "judge.cpp", "interactor");
  await f.compiler("http://other-judge:5050")(f.dataDir, "judge.cpp", "checker");
  await f.compiler()(f.dataDir, "judge.cpp", "checker");
  assert.equal(f.state.compiles, 3);
});

test("failed compilation never falls back to the old program and can be retried", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  await compile(f.dataDir, "judge.cpp");
  await fs.writeFile(f.sourcePath, "broken-v2");
  f.state.failCompile = true;
  await assert.rejects(compile(f.dataDir, "judge.cpp"), /syntax error/);
  assert.equal(f.state.uploads, 1);
  assert.equal(f.redis.values.size, 0);
  f.state.failCompile = false;
  await compile(f.dataDir, "judge.cpp");
  await compile(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 3);
});

test("missing output and failed downloads are not cached, and temporary files are removed", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  f.state.missingExecutable = true;
  await assert.rejects(compile(f.dataDir, "judge.cpp"), /no executable/);
  f.state.missingExecutable = false;
  f.state.failDownload = true;
  await assert.rejects(compile(f.dataDir, "judge.cpp"), /Failed to download/);
  assert.equal(f.files.size, 0);
  f.state.failDownload = false;
  await compile(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 3);
});

test("failed uploads can retry from the persisted binary", async (t) => {
  const f = await fixture(t);
  f.state.failUpload = true;
  await assert.rejects(f.compiler()(f.dataDir, "judge.cpp"), /Failed to upload/);
  f.state.failUpload = false;
  await f.compiler()(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 1);
});

test("a lost compilation lease cannot publish a cache or release another worker's lease", async (t) => {
  const f = await fixture(t);
  const evaluate = f.redis.eval.bind(f.redis);
  const mock = t.mock.method(f.redis, "eval", async (script: string, keyCount: number, ...args: (string | number)[]) => {
    if (args.length === 3) {
      const entry = f.redis.values.get(String(args[0]));
      assert.ok(entry);
      entry.token = "another-worker";
    }
    return evaluate(script, keyCount, ...args);
  });
  await assert.rejects(f.compiler()(f.dataDir, "judge.cpp"), /lease was lost/);
  await assert.rejects(f.cacheFile(), { code: "ENOENT" });
  assert.equal(f.files.size, 0);
  assert.equal(f.state.uploads, 0);
  assert.equal(f.redis.values.size, 1, "the new owner's lease must not be removed");
  mock.mock.restore();
  for (const entry of f.redis.values.values()) entry.expires = Date.now() - 1;
  await f.compiler()(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 2, "an abandoned lease expires and allows a retry");
  assert.equal(f.redis.values.size, 0);
});

test("corrupted cache metadata or binary data is rebuilt", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  await compile(f.dataDir, "judge.cpp");
  const cache = await f.cacheFile();
  await fs.writeFile(cache, "{truncated");
  await compile(f.dataDir, "judge.cpp");
  const entry = JSON.parse(await fs.readFile(cache, "utf8"));
  entry.executable = Buffer.from("corrupt").toString("base64");
  await fs.writeFile(cache, JSON.stringify(entry));
  await compile(f.dataDir, "judge.cpp");
  assert.equal(f.state.compiles, 3);
});

test("deleted sources, missing headers and invalid paths do not reuse old executables", async (t) => {
  const f = await fixture(t);
  const compile = f.compiler();
  await compile(f.dataDir, "judge.cpp");
  await assert.rejects(compile(f.dataDir, "../testlib.h", "interactor"), /Invalid relative data file path/);
  await fs.unlink(f.sourcePath);
  await assert.rejects(compile(f.dataDir, "judge.cpp"), /checker file not found/);
  await fs.writeFile(f.sourcePath, "source-v1");
  await fs.unlink(f.testlibPath);
  await assert.rejects(compile(f.dataDir, "judge.cpp"), /testlib.h not found/);
  assert.equal(f.state.uploads, 1);
});
