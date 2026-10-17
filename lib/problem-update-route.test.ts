import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as archives from "./problem-archive";
import { ProblemUpdateBusyError } from "./problem-update";

type UpdateCall = {
  where: { id: number };
  data: Record<string, unknown>;
  select: Record<string, boolean>;
};
type Route = {
  POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response>;
};

const sourceProblem = {
  id: 999,
  title: "Replacement problem",
  type: "default",
  defaultTimeLimit: 2000,
  defaultMemoryLimit: 512,
  sections: [{ title: "Description", content: "![image](/api/problems/999/assets/figure.png)" }],
  samples: [{ input: " 1\n", output: "2\n" }],
};

function harness(options: {
  admin?: { isGlobalAdmin: boolean } | null;
  exists?: boolean;
  replaceError?: Error;
  saveError?: Error;
} = {}) {
  const reads: unknown[] = [];
  const writes: UpdateCall[] = [];
  const replacements: { id: number; files: ReadonlyMap<string, Buffer> }[] = [];
  const invalidations: string[] = [];
  const dbNull = Object.freeze({ databaseNull: true });
  let parses = 0;
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "next/cache": { revalidatePath: (value: string) => invalidations.push(value) },
    "@/lib/auth": { getCurrentSuper: async () => options.admin === undefined ? { isGlobalAdmin: true } : options.admin },
    "@/lib/prisma": { prisma: { problem: {
      findUnique: async (query: unknown) => {
        reads.push(query);
        return options.exists === false ? null : { id: 42 };
      },
      update: async (query: UpdateCall) => {
        writes.push(query);
        if (options.saveError) throw options.saveError;
        return { id: query.where.id, title: query.data.title };
      },
      create: async () => assert.fail("Updating an existing problem must never insert a problem"),
    } } },
    "@/lib/generated/prisma/client": { Prisma: { DbNull: dbNull } },
    "@/lib/problem-archive": {
      ...archives,
      parseSingleProblemArchive: async (...args: Parameters<typeof archives.parseSingleProblemArchive>) => {
        parses++;
        return archives.parseSingleProblemArchive(...args);
      },
    },
    "@/lib/problem-update": {
      ProblemUpdateBusyError,
      replaceProblemFiles: async (id: number, files: ReadonlyMap<string, Buffer>, save: () => Promise<unknown>) => {
        replacements.push({ id, files });
        if (options.replaceError) throw options.replaceError;
        return save();
      },
    },
  };
  const filename = "app/api/problems/[id]/update/route.ts";
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
    File, Buffer, Response,
    console: { error() {} },
  }, { filename });
  const route = exports as Route;
  return {
    reads, writes, replacements, invalidations, dbNull,
    get parses() { return parses; },
    post: (request: Request, id = "42") => route.POST(request, { params: Promise.resolve({ id }) }),
  };
}

async function zipFile(entries: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([new Uint8Array(bytes)], "problem.zip", { type: "application/zip" });
}

function upload(file?: File, extra?: (form: FormData) => void) {
  const form = new FormData();
  if (file) form.append("file", file);
  extra?.(form);
  return new Request("https://example.test/api/problems/42/update", { method: "POST", body: form });
}

async function basicPackage() {
  return zipFile({ "problem_999/problem.json": JSON.stringify(sourceProblem) });
}

function assertNoMutation(state: ReturnType<typeof harness>) {
  assert.equal(state.writes.length, 0);
  assert.equal(state.replacements.length, 0);
  assert.equal(state.invalidations.length, 0);
}

test("problem replacement requires a global administrator before reading or parsing the package", async () => {
  const file = await basicPackage();
  for (const [admin, status] of [[null, 401], [{ isGlobalAdmin: false }, 403]] as const) {
    const state = harness({ admin });
    const response = await state.post(upload(file));
    assert.equal(response.status, status);
    assert.ok((await response.json()).error);
    assert.equal(state.reads.length, 0);
    assert.equal(state.parses, 0);
    assertNoMutation(state);
  }
});

test("invalid target IDs and missing problems cannot update files or insert a new problem", async () => {
  const file = await basicPackage();
  for (const id of ["", "0", "-1", "42.5", "42junk", "2147483648"]) {
    const state = harness();
    assert.equal((await state.post(upload(file), id)).status, 400, id);
    assert.equal(state.reads.length, 0);
    assert.equal(state.parses, 0);
    assertNoMutation(state);
  }
  const missing = harness({ exists: false });
  assert.equal((await missing.post(upload(file))).status, 404);
  assert.equal(missing.reads.length, 1);
  assert.equal(missing.parses, 0);
  assertNoMutation(missing);
});

test("the endpoint only accepts one ZIP upload, including files submitted under additional form keys", async () => {
  const file = await basicPackage();
  const requests = [
    upload(),
    upload(undefined, (form) => form.append("file", "problem.zip")),
    upload(new File([await file.arrayBuffer()], "problem.json")),
    upload(file, (form) => form.append("file", file)),
    upload(file, (form) => form.append("extra", file)),
    upload(file, (form) => form.append("file", "extra value")),
    new Request("https://example.test/", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }),
  ];
  for (const request of requests) {
    const state = harness();
    assert.equal((await state.post(request)).status, 400);
    assert.equal(state.parses, 0);
    assertNoMutation(state);
  }
});

test("corrupt ZIPs, invalid metadata, and packages without a problem are rejected before mutation", async () => {
  const files = [
    new File(["not a ZIP"], "broken.zip"),
    await zipFile({ "problem.json": "{broken" }),
    await zipFile({ "problem.json": JSON.stringify({ ...sourceProblem, defaultTimeLimit: -1 }) }),
    await zipFile({ "readme.txt": "No problem metadata" }),
  ];
  for (const file of files) {
    const state = harness();
    const response = await state.post(upload(file));
    assert.equal(response.status, 400, file.name);
    assert.ok((await response.json()).error);
    assert.equal(state.parses, 1);
    assertNoMutation(state);
  }
});

test("a ZIP containing multiple problems is rejected even when their names and exported IDs match", async () => {
  const file = await zipFile({
    "first/problem.json": JSON.stringify(sourceProblem),
    "second/problem.json": JSON.stringify(sourceProblem),
  });
  const state = harness();
  const response = await state.post(upload(file));
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
  assert.equal(state.parses, 1);
  assertNoMutation(state);
});

test("a valid package replaces the selected ID, rewrites assets, and returns the updated title", async () => {
  const file = await zipFile({
    "problem_999/problem.json": JSON.stringify({ ...sourceProblem, hint: "See /api/problems/999/assets/figure.png" }),
    "problem_999/data/1.in": "1\n",
    "problem_999/data/1.out": "2\n",
    "problem_999/assets/figure.png": new Uint8Array([0, 255, 3, 128]),
  });
  const state = harness();
  const response = await state.post(upload(file));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, problem: { id: 42, title: sourceProblem.title } });
  assert.equal(state.parses, 1);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].where.id, 42);
  const data = state.writes[0].data;
  assert.equal(data.id, undefined);
  assert.equal(data.title, sourceProblem.title);
  assert.equal(data.type, "default");
  assert.equal(data.defaultTimeLimit, 2000);
  assert.equal(data.defaultMemoryLimit, 512);
  assert.deepEqual(data.samples, sourceProblem.samples);
  assert.deepEqual(data.sections, [{ title: "Description", content: "![image](/api/problems/42/assets/figure.png)" }]);
  assert.equal(data.hint, "See /api/problems/42/assets/figure.png");
  assert.equal(data.contestProblems, undefined);
  assert.equal(data.submissions, undefined);
  assert.equal(state.replacements.length, 1);
  assert.equal(state.replacements[0].id, 42);
  assert.equal(state.replacements[0].files.get("data/1.in")?.toString(), "1\n");
  assert.equal(state.replacements[0].files.get("data/1.out")?.toString(), "2\n");
  assert.deepEqual(state.replacements[0].files.get("assets/figure.png"), Buffer.from([0, 255, 3, 128]));
  assert.ok(state.invalidations.includes("/admin/problems"));
});

test("omitted optional metadata clears old hints and judge configuration instead of retaining stale values", async () => {
  const state = harness();
  const response = await state.post(upload(await basicPackage()));
  assert.equal(response.status, 200);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].data.hint, null);
  assert.equal(state.writes[0].data.judgeConfig, state.dbNull);
  assert.equal(state.replacements[0].files.size, 0);
});

test("an already running replacement returns a retryable conflict without saving metadata", async () => {
  const state = harness({ replaceError: new ProblemUpdateBusyError() });
  const response = await state.post(upload(await basicPackage()));
  assert.equal(response.status, 409);
  assert.ok((await response.json()).error);
  assert.equal(state.writes.length, 0);
  assert.equal(state.invalidations.length, 0);
});

test("storage and database failures return a generic error and never report success or invalidate pages", async () => {
  const file = await basicPackage();
  for (const options of [
    { replaceError: new Error("private storage detail") },
    { saveError: new Error("private database detail") },
  ]) {
    const state = harness(options);
    const response = await state.post(upload(file));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, undefined);
    assert.equal(typeof body.error, "string");
    assert.equal(JSON.stringify(body).includes("private"), false);
    assert.equal(state.invalidations.length, 0);
  }
});
