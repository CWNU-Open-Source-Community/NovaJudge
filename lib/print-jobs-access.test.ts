import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as jose from "jose";
import { NextRequest, NextResponse } from "next/server";
import ts from "typescript";
import type { UserJwtPayload } from "./auth";
import { ContestRole } from "./generated/prisma/enums";
import * as proctoring from "./proctoring-access";

function loadModule<T>(filename: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
    process: { env: { JWT_SECRET: "print-job-access-regression-secret" } },
    console: { error() {}, log() {} }, TextEncoder, URL,
  }, { filename });
  return exports as T;
}

async function harness(monitored = false) {
  const proof = "p".repeat(43);
  const storedUser = {
    id: "team-id", username: "team", role: ContestRole.TEAM as ContestRole, contestId: 1001,
    proctoringKeyHash: monitored ? proctoring.proctoringKeyHash(proof) : null,
  };
  const state = {
    user: storedUser as typeof storedUser | null,
    globalUser: { id: "global-id", username: "external", role: "GLOBAL_USER", isBanned: false },
    reads: [] as Record<string, unknown>[],
    contestGate: 200,
  };
  const url = "https://judge.test/api/contests/1001/print-jobs/mine";
  let currentRequest = new NextRequest(url);
  const db = {
    globalUser: { findUnique: async () => state.globalUser },
    user: { findUnique: async () => state.user },
    printJob: { findMany: async (query: Record<string, unknown>) => {
      state.reads.push(query);
      return [{ id: 1, sourceFilename: "answer.cpp", status: "PENDING" }];
    } },
  };
  const cookieStore = { cookies: async () => currentRequest.cookies };
  const auth = loadModule<typeof import("./auth")>("lib/auth.ts", {
    jose, "next/headers": cookieStore, "@/lib/prisma": { prisma: db },
  });
  const route = loadModule<typeof import("../app/api/contests/[contestId]/print-jobs/mine/route")>("app/api/contests/[contestId]/print-jobs/mine/route.ts", {
    "next/server": { NextResponse }, "next/headers": cookieStore,
    "@/lib/auth": auth, "@/lib/prisma": { prisma: db },
    "@/lib/generated/prisma/client": { ContestRole },
    "@/lib/proctoring-access": proctoring,
    "@/lib/contest-access": { contestAccessResponse: async () => state.contestGate === 200 ? null : NextResponse.json({ error: "Denied" }, { status: state.contestGate }) },
  });
  const proxy = loadModule<typeof import("../proxy")>("proxy.ts", {
    "next/server": { NextResponse }, "./lib/auth": auth, "./lib/prisma": { prisma: db }, "./lib/proctoring-access": proctoring,
  });
  const payload: UserJwtPayload = {
    userId: storedUser.id, username: storedUser.username, role: storedUser.role, contestId: storedUser.contestId, isGlobalAdmin: false,
    ...(monitored ? { loginSource: "PROCTORING", proctoringKeyHash: storedUser.proctoringKeyHash! } : {}),
  };
  const teamToken = await auth.signAuth(payload);
  const globalToken = await auth.signAuth({ userId: "global-id", username: "external", role: "GLOBAL_USER", isGlobalAdmin: false });
  const request = (headers: Record<string, string> = {}) => {
    currentRequest = new NextRequest(url, { headers: { cookie: `user_token=${teamToken}`, ...headers } });
    return currentRequest;
  };
  return {
    state, storedUser, proof, teamToken, globalToken, auth, payload, proxy,
    request,
    get: (req = request()) => route.GET(req, { params: Promise.resolve({ contestId: "1001" }) }),
  };
}

test("a global login cannot expose a monitored team's print jobs through a second cookie", async () => {
  for (const role of ["GLOBAL_USER", "SUPER_ADMIN"]) {
    const h = await harness(true);
    h.state.globalUser.role = role;
    const req = h.request({ cookie: `auth_token=${h.globalToken}; user_token=${h.teamToken}` });
    assert.equal((await h.proxy.proxy(req)).status, 200, "The proxy uses the active global identity");
    const response = await h.get(req);
    assert.equal(response.status, 401, role);
    assert.deepEqual(await response.json(), { jobs: [] });
    assert.equal(h.state.reads.length, 0);
  }
});

test("print history requires a current team account in the requested contest", async () => {
  for (const reason of ["guest", "invalid", "deleted", "other-contest", "changed-role", "team", "invalid-global"]) {
    const h = await harness();
    const headers: Record<string, string> = {};
    if (reason === "guest") headers.cookie = "";
    if (reason === "invalid") headers.cookie = "user_token=invalid";
    if (reason === "deleted") h.state.user = null;
    if (reason === "other-contest") {
      const token = await h.auth.signAuth({ ...h.payload, contestId: 1002 });
      h.storedUser.contestId = 1002;
      headers.cookie = `user_token=${token}`;
    }
    if (reason === "changed-role") h.storedUser.role = ContestRole.ADMIN;
    if (reason === "invalid-global") headers.cookie = `auth_token=invalid; user_token=${h.teamToken}`;
    const response = await h.get(h.request(headers));
    const allowed = reason === "team" || reason === "invalid-global";
    const expectedStatus = allowed ? 200 : ["other-contest", "changed-role"].includes(reason) ? 403 : 401;
    assert.equal(response.status, expectedStatus, reason);
    assert.equal(h.state.reads.length, allowed ? 1 : 0, reason);
    if (allowed) {
      assert.equal((await response.json()).jobs[0].sourceFilename, "answer.cpp");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const query = JSON.parse(JSON.stringify(h.state.reads[0]));
      assert.deepEqual(query.where, { contestId: 1001, userId: "team-id" });
      assert.equal(query.select.code, undefined);
    }
  }
});

test("print history independently checks the current proctoring binding and client proof", async () => {
  for (const reason of ["missing-proof", "wrong-proof", "rotated-binding", "removed-binding", "old-browser-session", "valid", "locked-contest"]) {
    const h = await harness(true);
    const headers: Record<string, string> = { [proctoring.PROCTORING_HEADER]: h.proof };
    if (reason === "missing-proof") delete headers[proctoring.PROCTORING_HEADER];
    if (reason === "wrong-proof") headers[proctoring.PROCTORING_HEADER] = "q".repeat(43);
    if (reason === "rotated-binding") h.storedUser.proctoringKeyHash = proctoring.proctoringKeyHash("q".repeat(43));
    if (reason === "removed-binding") h.storedUser.proctoringKeyHash = null;
    if (reason === "old-browser-session") {
      const token = await h.auth.signAuth({ ...h.payload, loginSource: undefined, proctoringKeyHash: undefined });
      headers.cookie = `user_token=${token}`;
    }
    if (reason === "locked-contest") h.state.contestGate = 403;
    const response = await h.get(h.request(headers));
    assert.equal(response.status, reason === "valid" ? 200 : 403, reason);
    assert.equal(h.state.reads.length, reason === "valid" ? 1 : 0, reason);
    if (reason !== "valid" && reason !== "locked-contest") {
      assert.equal((await response.json()).code, "PROCTORING_CLIENT_REQUIRED");
    }
  }
});
