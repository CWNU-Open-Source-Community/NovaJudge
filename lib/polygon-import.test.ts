import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "./generated/prisma/client";
import { polygonContestFixture, polygonFixture } from "../tests/fixtures/polygon";
import { parsePolygonProblems } from "./polygon-archive";
import { savePolygonImport } from "./polygon-import";

function database(failAfter?: number) {
  let nextId = 100;
  const rows: Record<string, unknown>[] = [];
  let committed = false;
  const tx = {
    problem: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (rows.length === failAfter) throw new Error("Database write failed");
        const result = { id: nextId++, ...data };
        rows.push(result);
        return { id: result.id, title: data.title };
      },
      async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
        Object.assign(rows.find((row) => row.id === where.id)!, data);
      },
    },
    contest: { async create() { assert.fail("Polygon imports must not create contests"); } },
    contestProblem: { async create() { assert.fail("Polygon imports must not attach problems to contests"); } },
  };
  const client = {
    async $transaction(callback: (value: typeof tx) => Promise<unknown>) {
      try { const result = await callback(tx); committed = true; return result; }
      catch (error) { rows.length = 0; throw error; }
    },
  } as unknown as Pick<PrismaClient, "$transaction">;
  return { client, rows, get committed() { return committed; } };
}

test("a Polygon contest export creates multiple bank problems without creating a contest or associations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polygon-import-"));
  try {
    const problems = await parsePolygonProblems(await polygonContestFixture());
    const db = database();
    const result = await savePolygonImport(db.client, problems, root);
    assert.equal(db.committed, true);
    assert.deepEqual(result.importedProblems, [
      { id: 100, title: "First problem", displayId: "A" },
      { id: 101, title: "Second problem", displayId: "B" },
    ]);
    assert.equal(db.rows.length, 2);
    assert.equal("importedContest" in result, false);
    assert.deepEqual(db.rows[0].sections, problems[0].archive.data.sections.map((section) => ({ ...section,
      content: section.content.replaceAll("/api/problems/0/", "/api/problems/100/"),
    })));
    assert.deepEqual((db.rows[0].sections as { title: string }[]).map((section) => section.title), ["Problem Description", "Input", "Output"]);
    assert.match(JSON.stringify(db.rows[0].sections), /\/api\/problems\/100\/assets/);
    assert.match(JSON.stringify(db.rows[1].sections), /\/api\/problems\/101\/assets/);
    assert.equal(await fs.readFile(path.join(root, "100", "data", "002.in"), "utf8"), "-7 10\n");
    assert.equal(await fs.readFile(path.join(root, "101", "data", "002.in"), "utf8"), "-7 10\n");
    assert.equal((await fs.readdir(path.join(root, "100", "assets"))).length, 1);
    assert.equal(problems[0].archive.data.sections[0].content.includes("/api/problems/0/assets/"), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("database failure rolls back the batch and removes already written problem files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polygon-import-"));
  try {
    const [problem] = await parsePolygonProblems(polygonFixture());
    const db = database(1);
    await assert.rejects(savePolygonImport(db.client, [problem, problem], root), /Database write failed/);
    assert.equal(db.committed, false);
    assert.equal(db.rows.length, 0);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("existing directories are not overwritten or removed if importing fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polygon-import-"));
  try {
    await fs.mkdir(path.join(root, "100"));
    await fs.writeFile(path.join(root, "100", "keep.txt"), "existing");
    const problems = await parsePolygonProblems(polygonFixture());
    const db = database();
    await assert.rejects(savePolygonImport(db.client, problems, root), /EEXIST/);
    assert.equal(await fs.readFile(path.join(root, "100", "keep.txt"), "utf8"), "existing");
    assert.equal(db.rows.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("a file write failure rolls back database changes and cleans only this batch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polygon-import-"));
  try {
    const problems = await parsePolygonProblems(polygonFixture());
    problems[0].archive.files.set("data/../../escape", Buffer.from("bad"));
    const db = database();
    await assert.rejects(savePolygonImport(db.client, problems, root), /Invalid Polygon output/);
    assert.equal(db.rows.length, 0);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
