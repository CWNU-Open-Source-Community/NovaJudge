import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import ts from "typescript";
import { polygonContestFixture, polygonFixture, polygonProtocolFixture } from "../tests/fixtures/polygon";
import * as archives from "./polygon-archive";
import { ProblemArchiveError } from "./problem-archive";
import { normalizeProblemSamples } from "./problem-samples";

function harness(kind: "problems" | "contests", auth: "admin" | "user" | "anonymous" = "admin") {
  const saved: { problems: (archives.PolygonProblem & { displayId?: string })[] }[] = [];
  const nativeCreates: Record<string, unknown>[] = [];
  const nativeContests: Record<string, unknown>[] = [];
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "next/headers": { cookies: async () => ({ get: () => auth === "anonymous" ? undefined : { value: "session" } }) },
    "@/lib/auth": { verifyAuth: async () => ({ isGlobalAdmin: auth === "admin" }) },
    "@/lib/prisma": { prisma: {
      problem: {
        create: async ({ data }: { data: Record<string, unknown> }) => { nativeCreates.push(data); return { id: 123, title: data.title }; },
        update: async () => { throw new Error("Unexpected update"); },
      },
      contest: {
        create: async ({ data }: { data: Record<string, unknown> }) => { nativeContests.push(data); return { id: 12, title: data.title }; },
      },
      contestProblem: { create: async () => assert.fail("Polygon imports must not attach problems to contests") },
    } },
    "@/lib/problem-archive": { ProblemArchiveError },
    "@/lib/problem-samples": { normalizeProblemSamples },
    "@/lib/polygon-archive": archives,
    "@/lib/polygon-import": {
      savePolygonImport: async (_db: unknown, problems: (archives.PolygonProblem & { displayId?: string })[], ...extra: unknown[]) => {
        assert.equal(extra.length, 0, "The upload endpoint must not pass contest settings to the problem importer");
        saved.push({ problems });
        return { importedProblems: problems.map((problem, index) => ({ id: 100 + index, title: problem.archive.data.title,
          ...(problem.displayId ? { displayId: problem.displayId } : {}) })),
          warnings: problems.flatMap((problem) => problem.warnings) };
      },
    },
    "@/lib/generated/prisma/client": { ContestType: { PRIVATE: "PRIVATE" } },
    fs: { promises: { mkdir: async () => {}, writeFile: async () => {} } },
    path,
  };
  const filename = `app/api/${kind}/import/route.ts`;
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {} as { POST: (request: Request) => Promise<Response> };
  vm.runInNewContext(compiled.outputText, {
    exports, require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, File, Buffer, process: { cwd: () => process.cwd() }, console: { error() {} },
  }, { filename });
  return { saved, nativeCreates, nativeContests, post: exports.POST };
}

async function upload(zip: JSZip, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }))], "practice.zip"));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://example.test/import", { method: "POST", body: form });
}

test("both import routes require an administrator before processing a ZIP", async () => {
  for (const kind of ["problems", "contests"] as const) {
    for (const auth of ["anonymous", "user"] as const) {
      const app = harness(kind, auth);
      assert.equal((await app.post(await upload(polygonFixture()))).status, auth === "anonymous" ? 401 : 403);
      assert.equal(app.saved.length, 0);
    }
  }
});

test("problem endpoint accepts Polygon explicitly and through automatic detection", async () => {
  for (const fields of [{ format: "polygon" }, {}] as Record<string, string>[]) {
    const app = harness("problems");
    const response = await app.post(await upload(polygonFixture(), fields));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.importedProblems, [{ id: 100, title: "A & B" }]);
    assert.deepEqual(result.errors, []);
    assert.equal(app.saved.length, 1);
    assert.equal(app.nativeCreates.length, 0);
  }
});

test("both endpoints import all Polygon contest problems in descriptor order without a schedule or contest creation", async () => {
  for (const kind of ["problems", "contests"] as const) {
    for (const fields of [{ format: "polygon" }, {}] as Record<string, string>[]) {
      const app = harness(kind);
      const response = await app.post(await upload(await polygonContestFixture(), fields));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result.importedProblems, [
        { id: 100, title: "First problem", displayId: "A" },
        { id: 101, title: "Second problem", displayId: "B" },
      ]);
      if (kind === "contests") assert.deepEqual(result.importedContests, []);
      assert.equal(result.importedContest, undefined);
      assert.equal(result.contests, undefined);
      assert.equal(app.nativeContests.length, 0);
      assert.equal(app.saved[0].problems.length, 2);
    }
  }
});

test("old contest settings do not cause Polygon imports to create a contest", async () => {
  const app = harness("contests");
  const response = await app.post(await upload(await polygonContestFixture(), {
    format: "polygon", title: "Must not create", startTime: "invalid", endTime: "invalid",
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).importedProblems.length, 2);
  assert.equal(app.nativeContests.length, 0);
});

test("both import endpoints accept mixed packages with zero-valued points without creating contests", async () => {
  const zip = polygonProtocolFixture(1, [1], "problems/interactive/");
  const xmlPath = "problems/interactive/problem.xml";
  zip.file(xmlPath, (await zip.file(xmlPath)!.async("text")).replaceAll('<test method=', '<test points="0.0" method='));
  const communication = polygonProtocolFixture(2, [1, 2], "problems/communication/");
  for (const [name, entry] of Object.entries(communication.files)) {
    if (!entry.dir) zip.file(name, await entry.async("nodebuffer"), { createFolders: false });
  }
  zip.file("contest.xml", '<contest><problems><problem index="A" path="problems/interactive"/><problem index="B" path="problems/communication"/></problems></contest>');
  for (const kind of ["problems", "contests"] as const) {
    const app = harness(kind);
    const response = await app.post(await upload(zip, { format: "polygon" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).importedProblems.length, 2);
    assert.deepEqual(app.saved[0].problems.map((problem) => problem.archive.data.type), ["interactive", "communication"]);
    assert.equal(app.nativeContests.length, 0);
  }
});

test("invalid packages return useful 400 errors without any writes", async () => {
  for (const kind of ["problems", "contests"] as const) {
    const app = harness(kind);
    const zip = polygonFixture();
    zip.remove("tests/02.a");
    const response = await app.post(await upload(zip, { format: "polygon" }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Missing Polygon test data/);
    assert.equal(app.saved.length, 0);
    assert.equal(app.nativeCreates.length, 0);
  }
});

test("native contest backups still restore contests through the existing import format", async () => {
  const app = harness("contests");
  const zip = new JSZip().file("contest.json", JSON.stringify({
    title: "Native backup", startTime: "2030-01-01T02:00:00Z", endTime: "2030-01-01T07:00:00Z", type: "PUBLIC", status: "PENDING",
  }));
  const response = await app.post(await upload(zip, { format: "native" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.importedContests, ["Native backup"]);
  assert.deepEqual(result.errors, []);
  assert.equal(app.nativeContests.length, 1);
  assert.equal(app.saved.length, 0);
});

test("native problem import remains available, including ZIPs without explicit directory entries", async () => {
  for (const prefix of ["", "problem_123/"]) {
    const app = harness("problems");
    const zip = new JSZip();
    zip.file(`${prefix}problem.json`, JSON.stringify({ title: "Existing format", type: "default", defaultTimeLimit: 1000,
      defaultMemoryLimit: 256, sections: [], samples: [] }), { createFolders: false });
    const response = await app.post(await upload(zip, { format: "native" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).importedProblems.length, 1);
    assert.equal(app.nativeCreates.length, 1);
    assert.equal(app.saved.length, 0);
  }
});

test("both routes reject unknown formats and files without supported metadata", async () => {
  for (const kind of ["problems", "contests"] as const) {
    const app = harness(kind);
    assert.equal((await app.post(await upload(polygonFixture(), { format: "wrong" }))).status, 400);
    const empty = new JSZip().file("readme.txt", "no problem here");
    assert.equal((await app.post(await upload(empty))).status, 400);
    const form = new FormData();
    form.set("file", "not a File");
    assert.equal((await app.post(new Request("https://example.test/import", { method: "POST", body: form }))).status, 400);
    assert.equal(app.saved.length, 0);
  }
});
