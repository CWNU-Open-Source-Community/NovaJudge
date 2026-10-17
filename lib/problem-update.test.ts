import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ProblemUpdateBusyError, replaceProblemFiles } from "./problem-update";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "problem-update-test-"));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("problem-update-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const target = path.join(root, "42");
  await fs.mkdir(path.join(target, "data"), { recursive: true });
  await fs.mkdir(path.join(target, "assets"));
  await fs.writeFile(path.join(target, "data", "old.in"), "original input");
  await fs.writeFile(path.join(target, "assets", "old.png"), "original image");
  return { root, target };
}

test("replacement removes obsolete files and installs all files before saving the same problem", async (t) => {
  const { root, target } = await fixture(t);
  await fs.mkdir(path.join(root, "43", "data"), { recursive: true });
  await fs.writeFile(path.join(root, "43", "data", "keep.in"), "other problem");
  const files = new Map([
    ["data/new.in", Buffer.from("new input")],
    ["assets/new.png", Buffer.from([0, 255, 2, 128])],
  ]);
  const updated = await replaceProblemFiles(42, files, async () => {
    assert.deepEqual(await fs.readdir(path.join(target, "data")), ["new.in"]);
    assert.deepEqual(await fs.readdir(path.join(target, "assets")), ["new.png"]);
    assert.deepEqual(await fs.readFile(path.join(target, "assets", "new.png")), files.get("assets/new.png"));
    return { id: 42, title: "Updated title" };
  }, root);
  assert.deepEqual(updated, { id: 42, title: "Updated title" });
  assert.equal(await fs.readFile(path.join(root, "43", "data", "keep.in"), "utf8"), "other problem");
  assert.deepEqual((await fs.readdir(root)).sort(), ["42", "43"]);
});

test("a database failure restores original data and assets and permits retry", async (t) => {
  const { root, target } = await fixture(t);
  await assert.rejects(replaceProblemFiles(42, new Map([["data/new.in", Buffer.from("new")]]), async () => {
    throw new Error("Database unavailable");
  }, root), /Database unavailable/);
  assert.equal(await fs.readFile(path.join(target, "data", "old.in"), "utf8"), "original input");
  assert.equal(await fs.readFile(path.join(target, "assets", "old.png"), "utf8"), "original image");
  assert.deepEqual(await fs.readdir(root), ["42"]);
  await replaceProblemFiles(42, new Map(), async () => undefined, root);
  assert.deepEqual(await fs.readdir(path.join(target, "data")), []);
  assert.deepEqual(await fs.readdir(path.join(target, "assets")), []);
});

test("problems without existing upload directories can be replaced and rolled back", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(replaceProblemFiles(99, new Map(), async () => {
    throw new Error("Save failed");
  }, root), /Save failed/);
  assert.deepEqual(await fs.readdir(root), ["42"]);
  await replaceProblemFiles(99, new Map(), async () => undefined, root);
  assert.deepEqual((await fs.readdir(path.join(root, "99"))).sort(), ["assets", "data"]);
});

test("staging failures leave the old problem untouched and never save metadata", async (t) => {
  const { root, target } = await fixture(t);
  let saved = false;
  await assert.rejects(replaceProblemFiles(42, new Map([
    ["data/valid.in", Buffer.from("valid")],
    ["data/../../escape", Buffer.from("invalid")],
  ]), async () => { saved = true; }, root), /Invalid problem file path/);
  assert.equal(saved, false);
  assert.equal(await fs.readFile(path.join(target, "data", "old.in"), "utf8"), "original input");
  assert.deepEqual(await fs.readdir(root), ["42"]);
});

test("simultaneous replacement of the same problem is rejected without disturbing the first update", async (t) => {
  const { root, target } = await fixture(t);
  let release!: () => void;
  let installed!: () => void;
  const saving = new Promise<void>((resolve) => { installed = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const first = replaceProblemFiles(42, new Map([["data/first.in", Buffer.from("first")]]), async () => {
    installed();
    await hold;
  }, root);
  await saving;
  try {
    await assert.rejects(replaceProblemFiles(42, new Map(), async () => {
      assert.fail("A concurrent request must never save metadata");
    }, root), ProblemUpdateBusyError);
  } finally {
    release();
    await first;
  }
  assert.equal(await fs.readFile(path.join(target, "data", "first.in"), "utf8"), "first");
  assert.deepEqual(await fs.readdir(root), ["42"]);
});
