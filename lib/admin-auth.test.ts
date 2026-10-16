import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ServerAction = (...args: unknown[]) => Promise<unknown>;

function loadModule(filename: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(path.resolve(filename), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, ServerAction> = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => dependencies[name] ?? {},
    process,
    console: { error() {}, log() {} },
  }, { filename });
  return exports;
}

test("the administrator guard rejects guests and ordinary global users", async () => {
  for (const user of [null, { userId: "ordinary", isGlobalAdmin: false }]) {
    const auth = loadModule("lib/admin-auth.ts", {
      "@/lib/auth": { getCurrentSuper: async () => user },
    });
    await assert.rejects(auth.requireSuperAdmin(), /Unauthorized/);
  }
});

test("the administrator guard accepts the verified super administrator", async () => {
  const user = { userId: "admin", isGlobalAdmin: true };
  const auth = loadModule("lib/admin-auth.ts", {
    "@/lib/auth": { getCurrentSuper: async () => user },
  });
  assert.equal(await auth.requireSuperAdmin(), user);
});

const protectedActionFiles = [
  "app/admin/actions.ts",
  "app/admin/contests/actions.ts",
  "app/admin/contests/[id]/edit/actions.ts",
  "app/admin/contests/[id]/users/actions.ts",
  "app/admin/contests/[id]/problems/actions.ts",
  "app/admin/problems/actions.ts",
  "app/admin/problems/[id]/assets/actions.ts",
  "app/admin/problems/[id]/data/actions.ts",
  "app/admin/problems/[id]/test/actions.ts",
  "app/admin/submissions/actions.ts",
];

for (const filename of protectedActionFiles) {
  test(`direct calls to ${filename} cannot bypass administrator access`, async () => {
    for (const user of [null, { userId: "ordinary", isGlobalAdmin: false }]) {
      let authChecks = 0;
      let effects = 0;
      const auth = loadModule("lib/admin-auth.ts", {
        "@/lib/auth": {
          getCurrentSuper: async () => {
            authChecks++;
            return user;
          },
        },
      });
      const forbiddenEffect = new Proxy(() => {
        effects++;
        throw new Error("Protected storage was accessed before authorization");
      }, { get: () => forbiddenEffect });
      const actions = loadModule(filename, {
        "@/lib/admin-auth": auth,
        "@/lib/prisma": { prisma: forbiddenEffect },
        "fs": { promises: forbiddenEffect },
        "fs/promises": forbiddenEffect,
        "path": path,
        "next/cache": { revalidatePath: forbiddenEffect },
        "@/lib/queue": { enqueueJudge: forbiddenEffect },
        "@/lib/worker-registry": {
          listJudgeWorkers: forbiddenEffect,
          getJudgeQueueStats: forbiddenEffect,
        },
      });

      for (const [name, action] of Object.entries(actions)) {
        // This public capability list contains no contest or user data.
        if (name === "getSupportedLanguages") continue;
        const previousChecks = authChecks;
        const outcome = await action().then(
          (result) => ({ result, error: undefined }),
          (error: unknown) => ({ result: undefined, error }),
        );
        if (outcome.error !== undefined) {
          assert.match(String(outcome.error), /Unauthorized/, name);
        } else {
          assert.equal((outcome.result as { error?: string })?.error, "Unauthorized", name);
        }
        assert.equal(authChecks, previousChecks + 1, `${name} must verify the caller`);
        assert.equal(effects, 0, `${name} must reject before touching protected data`);
      }
    }
  });
}
