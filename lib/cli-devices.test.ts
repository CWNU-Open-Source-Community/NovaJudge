import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as policy from "./cli-device-policy";
import * as grants from "./contest-access-token";
import { decodeJwt } from "jose";
import { lockCliSettings } from "./cli-settings-lock";
import * as proctoring from "./proctoring-access";
import type { UserJwtPayload } from "./auth";
import type { Submission } from "./generated/prisma/client";

const base = "https://judge.test";
const secret = new TextEncoder().encode("cli-device-regression-secret");
const validToken = `njcli_${"a".repeat(43)}`;
const proctoringProof = "p".repeat(43);

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
    console: { error() {} }, Date, SyntaxError, Error, setTimeout, clearTimeout,
  }, { filename });
  return exports as T;
}

type Service = typeof import("./cli-devices");
type TestContest = { id: number; title: string; type: string; password: string | null };
type TestUser = { id: string; contestId: number; username: string; displayName: string; password: string; role: string; proctoringKeyHash: string | null };
type TestDevice = {
  id: string; tokenHash: string; userCode: string; contestId: number; userId: string | null;
  contestAccessToken: string | null; approvedAt: Date | null; pairingExpiresAt: Date; expiresAt: Date;
  proctoringKeyHash: string | null;
};

function harness(privateContest = false) {
  const contest: TestContest = { id: 2, title: "Secret contest title", type: privateContest ? "PRIVATE" : "PUBLIC", password: privateContest ? "contest secret" : null };
  const user: TestUser = { id: "team-id", contestId: 2, username: "team", displayName: "Test team", password: "stored-hash", role: "TEAM", proctoringKeyHash: null };
  const device: TestDevice = {
    id: "device-id", tokenHash: policy.cliTokenHash(validToken), userCode: "ABCD-EFGH", contestId: 2,
    userId: null, contestAccessToken: null, proctoringKeyHash: null, approvedAt: null,
    pairingExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 3_600_000),
  };
  const state = {
    activeContestId: 2 as number | null, device: device as TestDevice | null, grantsAllowed: false, loginUpdates: 0,
    submissions: [] as Record<string, unknown>[], persisted: [] as Record<string, unknown>[], locks: [] as string[],
    duringPasswordCheck: null as (() => void) | null, beforePersistence: null as (() => void) | null,
    beforeTransaction: null as (() => void) | null, authValid: true,
    authPayload: {
      userId: user.id, username: user.username, contestId: user.contestId, role: "TEAM", isGlobalAdmin: false,
      loginSource: "PROCTORING", proctoringKeyHash: proctoring.proctoringKeyHash(proctoringProof),
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as UserJwtPayload,
  };
  const db = {
    cliSettings: { findUnique: async () => ({ activeContestId: state.activeContestId, activeContest: state.activeContestId === null ? null : { ...contest, id: state.activeContestId } }) },
    cliDevice: {
      findUnique: async ({ where }: { where: { tokenHash?: string; userCode?: string } }) => {
        if (!state.device || (where.tokenHash && where.tokenHash !== state.device.tokenHash) || (where.userCode && where.userCode !== state.device.userCode)) return null;
        return { ...state.device, contest: { ...contest }, user: state.device.userId ? { ...user } : null };
      },
      updateMany: async ({ where, data }: { where: { id: string; pairingExpiresAt: { gt: Date }; expiresAt: { gt: Date } }; data: Partial<TestDevice> }) => {
        if (!state.device || state.device.id !== where.id || state.device.approvedAt || state.device.pairingExpiresAt <= where.pairingExpiresAt.gt || state.device.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(state.device, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { tokenHash?: string } }) => {
        if (!where.tokenHash || !state.device || where.tokenHash !== state.device.tokenHash) return { count: 0 };
        state.device = null;
        return { count: 1 };
      },
      create: async ({ data }: { data: Omit<TestDevice, "id" | "userId" | "approvedAt" | "contestAccessToken" | "proctoringKeyHash"> & Partial<TestDevice> }) => {
        state.device = { id: "new-device", userId: null, approvedAt: null, contestAccessToken: null, proctoringKeyHash: null, ...data };
        return state.device;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id?: string; contestId_username?: { contestId: number; username: string } } }) => {
        if (where.id) return where.id === user.id ? { ...user } : null;
        return where.contestId_username?.contestId === user.contestId && where.contestId_username?.username === user.username ? { ...user } : null;
      },
      update: async () => { state.loginUpdates++; return user; },
    },
    submission: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.persisted.push(data);
        return { id: "submission", displayId: 1, ...data };
      },
    },
    $executeRaw: async (sql: TemplateStringsArray, ...values: number[]) => {
      state.locks.push(sql.join("?"));
      assert.deepEqual(values, [73921, 1]);
      return 1;
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => { state.beforeTransaction?.(); return callback(db); },
  };
  const service = loadModule<Service>("lib/cli-devices.ts", {
    "bcryptjs": { compare: async (password: string) => { state.duringPasswordCheck?.(); return password === "correct password"; } },
    "next/server": { NextResponse },
    "@/lib/prisma": { prisma: db },
    "@/lib/auth": { getJwtSecretKey: () => secret, verifyAuth: async () => {
      if (!state.authValid) throw new Error("Invalid JWT");
      return { ...state.authPayload };
    } },
    "jose": { decodeJwt },
    "@/lib/proctoring-access": proctoring,
    "@/lib/contest-access": { hasContestAccess: async () => state.grantsAllowed },
    "@/lib/contest-access-token": grants,
    "@/lib/request-ip": { getPrimaryClientIp: () => "127.0.0.1" },
    "@/lib/contest-submission": { createContestSubmission: async (input: Record<string, unknown>) => {
      state.beforePersistence?.();
      const persist = input.persistSubmission as (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
      const result = await persist({ contestId: input.contestId, userId: (input.actor as { userId: string }).userId });
      state.submissions.push(input);
      return result;
    } },
    "@/lib/cli-device-policy": policy,
    "@/lib/cli-rate-limit": { enforceCliRateLimit: async () => {} },
    "@/lib/cli-settings-lock": { lockCliSettings },
  });
  return { service, state, user, contest, device };
}

const request = (token = validToken) => new Request(`${base}/api/cli/device`, { headers: { authorization: `Bearer ${token}` } });
const approvalBody = { code: "ABCD-EFGH", username: "team", password: "correct password" };
const proctoringRequest = (headers: Record<string, string> = {}) => new Request(`${base}/api/cli/device/proctoring`, {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer monitored-jwt", [proctoring.PROCTORING_HEADER]: proctoringProof, ...headers }, body: "{}",
});

test("device credentials use independent random secrets and store only a SHA-256 hash", () => {
  const first = policy.generateCliCredentials();
  const second = policy.generateCliCredentials();
  assert.match(first.deviceToken, /^njcli_[A-Za-z0-9_-]{43}$/);
  assert.match(first.userCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(first.tokenHash, createHash("sha256").update(first.deviceToken).digest("hex"));
  assert.notEqual(first.deviceToken, second.deviceToken);
  assert.notEqual(first.userCode, second.userCode);
  assert.equal(policy.normalizeCliUserCode(" abcdefgh "), "ABCD-EFGH");
  for (const value of ["", "abcd", "ABCI-EFGH", null]) assert.throws(() => policy.normalizeCliUserCode(value));
  assert.throws(() => policy.cliTokenHash("eyJ.ordinary.jwt"));
});

test("browser approval requires same-origin JSON and rejects forged cross-site form requests", () => {
  const valid = { method: "POST", headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" }, body: "{}" };
  policy.assertSameOriginJson(new Request(`${base}/api/cli/device/approve`, valid));
  const invalidHeaders: Record<string, string>[] = [
    { "content-type": "text/plain", origin: base },
    { "content-type": "application/json", origin: "https://evil.test" },
    { "content-type": "application/json" },
    { "content-type": "application/json", origin: base, "sec-fetch-site": "cross-site" },
  ];
  for (const headers of invalidHeaders) assert.throws(() => policy.assertSameOriginJson(new Request(`${base}/api/cli/device/approve`, { ...valid, headers })));
});

test("browser origins use the incoming Host instead of Next's internal listening address", () => {
  for (const host of ["127.0.0.1:3001", "192.168.1.42:3001", "judge.local:3001", "[::1]:3001", "judge.test:80"]) {
    const origin = new URL(`http://${host}`).origin;
    policy.assertSameOriginJson(new Request("http://localhost:3001/api/cli/device/approve", {
      method: "POST", headers: { "content-type": "application/json", origin, host, "sec-fetch-site": "same-origin" }, body: "{}",
    }));
  }
});

test("HTTPS reverse-proxy requests use the external forwarded authority and protocol", () => {
  const valid = {
    "content-type": "application/json", origin: "https://judge.test:8443", host: "localhost:3001",
    "x-forwarded-host": "judge.test:8443, internal-proxy:8080", "x-forwarded-proto": "https, http",
    "sec-fetch-site": "same-origin",
  };
  const request = (headers: Record<string, string>) => new Request("http://localhost:3001/api/admin/cli-settings", { method: "PUT", headers, body: "{}" });
  policy.assertSameOriginJson(request(valid));
  // Host-preserving proxies need only supply the original protocol.
  const hostPreserving: Record<string, string> = { ...valid };
  delete hostPreserving["x-forwarded-host"];
  policy.assertSameOriginJson(request({ ...hostPreserving, host: "judge.test:8443" }));
  for (const headers of [
    { ...valid, origin: "https://evil.test:8443" },
    { ...valid, origin: "https://judge.test" },
    { ...valid, origin: "http://judge.test:8443" },
    { ...valid, origin: "http://localhost:3001" },
    { ...valid, origin: "https://internal-proxy:8080" },
    { ...valid, origin: "https://judge.test:8443", "sec-fetch-site": "cross-site" },
    { ...valid, "x-forwarded-host": "judge.test:8443@evil.test" },
    { ...valid, "x-forwarded-host": "judge.test:8443/path" },
    { ...valid, "x-forwarded-host": "" },
    { ...valid, "x-forwarded-proto": "file" },
    { ...valid, origin: "null" },
    { ...valid, origin: "https://judge.test:8443/path" },
    { ...valid, origin: "https://user@judge.test:8443" },
    { ...valid, origin: "https://judge.test:8443, https://evil.test" },
  ]) assert.throws(() => policy.assertSameOriginJson(request(headers)), { code: "SAME_ORIGIN_REQUIRED" });
});

test("private contest names are hidden until access is authorized and pairing never exposes a stored token", async () => {
  const { service, state, contest } = harness(true);
  assert.equal((await service.publicCliSettings()).contest?.title, "Private contest");
  const pairing = await service.createCliDevice(request());
  assert.equal(pairing.contest.title, "Private contest");
  assert.equal(state.device?.tokenHash, policy.cliTokenHash(pairing.deviceToken));
  assert(!JSON.stringify(state.device).includes(pairing.deviceToken));
  const details = await service.cliApprovalDetails(pairing.userCode);
  assert.equal(details.contest.title, "Private contest");
  assert(!JSON.stringify(details).includes(pairing.deviceToken));
  state.grantsAllowed = true;
  assert.equal((await service.publicCliSettings()).contest?.title, contest.title);
  state.activeContestId = null;
  assert.equal((await service.publicCliSettings()).contest, null);
  await assert.rejects(service.createCliDevice(request()), { code: "CLI_DISABLED" });
});

test("wrong account or private-contest credentials do not consume the pairing code", async () => {
  const { service, device, state } = harness(true);
  for (const body of [
    { ...approvalBody, password: "wrong" },
    { ...approvalBody, username: "other-contest-team" },
    { ...approvalBody, contestPassword: "wrong contest secret" },
  ]) {
    await assert.rejects(service.approveCliDevice(request(), body));
    assert.equal(device.approvedAt, null);
    assert.equal(device.userId, null);
    assert.equal(state.loginUpdates, 0);
  }
  const approved = await service.approveCliDevice(request(), { ...approvalBody, contestPassword: "contest secret" });
  assert.equal(approved.success, true);
  assert.equal(device.userId, "team-id");
  assert.equal(state.loginUpdates, 1);
  assert.equal((await service.getCliDevice(request())).status, "ready");
  const grantClaims = decodeJwt(device.contestAccessToken!);
  assert.equal(grantClaims.exp! - grantClaims.iat!, policy.CLI_DEVICE_SECONDS);
  assert.equal(await grants.verifyContestAccessToken(device.contestAccessToken!, { id: 2, password: "contest secret" }, secret), true);
  assert(!JSON.stringify(approved).includes(validToken));
  assert(!JSON.stringify(approved).includes("contest secret"));
  await assert.rejects(service.approveCliDevice(request(), { ...approvalBody, contestPassword: "contest secret" }), { code: "ALREADY_APPROVED" });
});

test("only one concurrent approval can claim a pending code", async () => {
  const { service, state } = harness();
  const results = await Promise.allSettled([
    service.approveCliDevice(request(), approvalBody),
    service.approveCliDevice(request(), approvalBody),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.loginUpdates, 1);
});

test("a device invalidated while checking the password cannot be revived by approval", async () => {
  const { service, state, device } = harness();
  state.duringPasswordCheck = () => { device.expiresAt = new Date(Date.now() - 1); };
  await assert.rejects(service.approveCliDevice(request(), approvalBody), { code: "ALREADY_APPROVED" });
  assert.equal(device.approvedAt, null);
  assert.equal(device.userId, null);
  assert.equal(state.loginUpdates, 0);
});

test("staff and monitored accounts cannot bind devices", async () => {
  for (const mutation of [{ role: "ADMIN" }, { proctoringKeyHash: "monitor-binding" }]) {
    const { service, user, device } = harness();
    Object.assign(user, mutation);
    await assert.rejects(service.approveCliDevice(request(), approvalBody));
    assert.equal(device.approvedAt, null);
  }
});

test("a monitored login receives a preapproved submission-only device bounded by its JWT lifetime", async () => {
  const { service, user, state } = harness();
  user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
  const issued = await service.createProctoringCliDevice(proctoringRequest());
  assert.equal(issued.loginSource, "PROCTORING");
  assert.equal(issued.contest.id, 2);
  assert.equal(issued.user.username, "team");
  assert.match(issued.deviceToken, /^njcli_[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(issued.expiresAt), state.authPayload.exp! * 1000);
  assert.equal(state.device?.proctoringKeyHash, user.proctoringKeyHash);
  assert.equal(state.device?.userId, user.id);
  assert(state.device?.approvedAt);
  assert.equal(state.device?.tokenHash, policy.cliTokenHash(issued.deviceToken));
  assert(!JSON.stringify(issued).includes(proctoringProof));
  assert(!JSON.stringify(issued).includes("monitored-jwt"));
  assert(!JSON.stringify(state.device).includes(issued.deviceToken));
  const status = await service.getCliDevice(request(issued.deviceToken));
  assert.equal(status.status, "ready");
  assert.equal(status.loginSource, "PROCTORING");
  assert.equal(status.expiresAt, issued.expiresAt);
  const result = await service.submitCliDevice(request(issued.deviceToken), { problem: "A", language: "cpp", code: "int main(){}" });
  assert.equal(result.statusUrl, "/contest/2/status/1");
  assert.equal(state.persisted.length, 1);
  assert(state.locks.every((sql) => sql.includes("pg_advisory_xact_lock_shared")));
  await service.revokeCliDevice(request(issued.deviceToken));
  await assert.rejects(service.getCliDevice(request(issued.deviceToken)), { code: "INVALID_DEVICE_TOKEN" });
});

test("monitor device issuance requires a verified JWT and current independent proctoring proof", async () => {
  for (const reason of ["missingJwt", "invalidJwt", "missingProof", "wrongProof", "normalJwt", "missingBinding", "staleBinding", "expiredJwt"] as const) {
    const { service, state, user, device } = harness();
    user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
    const headers: Record<string, string> = {};
    if (reason === "missingJwt") headers.authorization = "";
    if (reason === "invalidJwt") state.authValid = false;
    if (reason === "missingProof") headers[proctoring.PROCTORING_HEADER] = "";
    if (reason === "wrongProof") headers[proctoring.PROCTORING_HEADER] = "q".repeat(43);
    if (reason === "normalJwt") { delete state.authPayload.loginSource; delete state.authPayload.proctoringKeyHash; }
    if (reason === "missingBinding") user.proctoringKeyHash = null;
    if (reason === "staleBinding") user.proctoringKeyHash = proctoring.proctoringKeyHash("q".repeat(43));
    if (reason === "expiredJwt") state.authPayload.exp = Math.floor(Date.now() / 1000) - 1;
    await assert.rejects(service.createProctoringCliDevice(proctoringRequest(headers)), {
      code: reason === "missingJwt" || reason === "invalidJwt" ? "PROCTORING_AUTH_REQUIRED" : "PROCTORING_CLIENT_REQUIRED",
    }, reason);
    assert.equal(state.device, device, reason);
    assert.equal(device.approvedAt, null, reason);
  }
});

test("monitor issuance checks both signed and current team membership and the administrator's active contest", async () => {
  for (const reason of ["jwtRole", "currentRole", "globalAdmin", "wrongUser", "userContest", "activeContest", "disabled"] as const) {
    const { service, state, user, device } = harness();
    user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
    if (reason === "jwtRole") state.authPayload.role = "ADMIN";
    if (reason === "currentRole") user.role = "JUDGE";
    if (reason === "globalAdmin") state.authPayload.isGlobalAdmin = true;
    if (reason === "wrongUser") state.authPayload.userId = "unknown-user";
    if (reason === "userContest") user.contestId = 3;
    if (reason === "activeContest") state.activeContestId = 3;
    if (reason === "disabled") state.activeContestId = null;
    const code = reason === "activeContest" ? "CONTEST_CHANGED" : reason === "disabled" ? "CLI_DISABLED" : "PROCTORING_CLIENT_REQUIRED";
    await assert.rejects(service.createProctoringCliDevice(proctoringRequest()), { code }, reason);
    assert.equal(state.device, device, reason);
  }
});

test("a private monitor grant must match the contest and is reused without extending its lifetime", async () => {
  const { service, state, user, contest, device } = harness(true);
  user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
  const validGrant = await grants.signContestAccessToken(contest, secret, 120);
  for (const grant of ["", "invalid", await grants.signContestAccessToken({ ...contest, id: 3 }, secret)]) {
    await assert.rejects(service.createProctoringCliDevice(proctoringRequest({ "x-contest-access-token": grant })), { code: "CONTEST_PASSWORD_REQUIRED" });
    assert.equal(state.device, device);
  }
  const issued = await service.createProctoringCliDevice(proctoringRequest({ "x-contest-access-token": validGrant }));
  assert.equal(state.device?.contestAccessToken, validGrant);
  assert.equal(Date.parse(issued.expiresAt), decodeJwt(validGrant).exp! * 1000);
  await service.submitCliDevice(request(issued.deviceToken), { problem: "A", language: "cpp", code: "int main(){}" });
  assert.equal(state.submissions[0].contestAccessToken, validGrant);
  contest.password = "rotated";
  assert.equal((await service.getCliDevice(request(issued.deviceToken))).code, "REAUTH_REQUIRED");
  await assert.rejects(service.submitCliDevice(request(issued.deviceToken), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "REAUTH_REQUIRED" });
  assert.equal(state.persisted.length, 1);
});

test("monitoring rotation and administrator invalidation revoke monitor-issued devices", async () => {
  for (const reason of ["rotation", "bindingRemoved", "contestChanged", "disabled", "expired"] as const) {
    const { service, state, user } = harness();
    user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
    const issued = await service.createProctoringCliDevice(proctoringRequest());
    if (reason === "rotation") user.proctoringKeyHash = proctoring.proctoringKeyHash("q".repeat(43));
    if (reason === "bindingRemoved") user.proctoringKeyHash = null;
    if (reason === "contestChanged") state.activeContestId = 3;
    if (reason === "disabled") state.activeContestId = null;
    if (reason === "expired") state.device!.expiresAt = new Date(Date.now() - 1);
    const expected = reason === "contestChanged" ? "CONTEST_CHANGED" : reason === "disabled" ? "CLI_DISABLED" : reason === "expired" ? "DEVICE_EXPIRED" : "REAUTH_REQUIRED";
    const status = await service.getCliDevice(request(issued.deviceToken));
    assert.equal(status.loginSource, "PROCTORING", reason);
    assert.equal(status.code, expected, reason);
    await assert.rejects(service.submitCliDevice(request(issued.deviceToken), { problem: "A", language: "cpp", code: "int main(){}" }), { code: expected }, reason);
    assert.equal(state.persisted.length, 0, reason);
  }
});

test("monitor authorization is checked inside issuance and again immediately before submission persistence", async () => {
  const { service, state, user, device } = harness();
  user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
  state.beforeTransaction = () => { user.proctoringKeyHash = proctoring.proctoringKeyHash("q".repeat(43)); };
  await assert.rejects(service.createProctoringCliDevice(proctoringRequest()), { code: "PROCTORING_CLIENT_REQUIRED" });
  assert.equal(state.device, device);
  state.beforeTransaction = null;
  user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
  const issued = await service.createProctoringCliDevice(proctoringRequest());
  state.beforePersistence = () => { user.proctoringKeyHash = proctoring.proctoringKeyHash("q".repeat(43)); };
  await assert.rejects(service.submitCliDevice(request(issued.deviceToken), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "REAUTH_REQUIRED" });
  assert.equal(state.persisted.length, 0);
});

test("monitor issuance API accepts native JSON requests and rejects browser form content", async () => {
  const { service, state, user } = harness();
  user.proctoringKeyHash = state.authPayload.proctoringKeyHash!;
  const route = loadModule<typeof import("../app/api/cli/device/proctoring/route")>("app/api/cli/device/proctoring/route.ts", { "@/lib/cli-devices": service });
  const response = await route.POST(proctoringRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).loginSource, "PROCTORING");
  assert.equal((await route.POST(proctoringRequest({ "content-type": "text/plain" }))).status, 415);
  assert.equal((await route.POST(new Request(`${base}/api/cli/device/proctoring`, { method: "POST", headers: { "content-type": "application/json" }, body: "[]" }))).status, 400);
});

test("submissions use the server's bound contest and user; contest changes require a new binding", async () => {
  const { service, state } = harness();
  await service.approveCliDevice(request(), approvalBody);
  const result = await service.submitCliDevice(request(), { contestId: 999, userId: "forged", problem: "a", language: "cpp", code: "int main(){}" });
  assert.equal(result.submission.id, "submission");
  assert.equal(result.submission.displayId, 1);
  assert.equal(result.statusUrl, "/contest/2/status/1", "The contest detail route resolves the display ID, not the database ID.");
  assert.equal(state.submissions[0].contestId, 2);
  assert.equal((state.submissions[0].actor as { userId: string }).userId, "team-id");
  assert.equal(state.submissions[0].problemDisplayId, "A");
  state.activeContestId = 3;
  assert.equal((await service.getCliDevice(request())).status, "contest_changed");
  await assert.rejects(service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "CONTEST_CHANGED" });
  assert.equal(state.submissions.length, 1);
  state.activeContestId = null;
  assert.equal((await service.getCliDevice(request())).code, "CLI_DISABLED");
});

test("legacy CLI submission links use the contest display ID rather than the database UUID", async () => {
  const submission = { id: "554902db-2c7c-4fde-adc7-44539171f0cb", displayId: 73 };
  const route = loadModule<typeof import("../app/api/cli/submit/route")>("app/api/cli/submit/route.ts", {
    "next/server": { NextResponse },
    "@/lib/auth": { verifyAuth: async () => ({ userId: "team-id", contestId: 2, role: "TEAM" }) },
    "@/lib/generated/prisma/client": { ContestRole: { TEAM: "TEAM" } },
    "@/lib/contest-submission": { createContestSubmission: async () => submission },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ id: "team-id", contestId: 2, role: "TEAM" }) } } },
    "../contest-access": { cliContestAccessResponse: async () => null },
  });
  const response = await route.POST(new Request(`${base}/api/cli/submit`, {
    method: "POST", headers: { authorization: "Bearer legacy-token", "content-type": "application/json" },
    body: JSON.stringify({ problem: "A", language: "cpp", code: "int main(){}" }),
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.submission.id, submission.id);
  assert.equal(result.statusUrl, "/contest/2/status/73");
});

test("switching the active contest after initial authorization rejects persistence without a submission", async () => {
  const { service, state } = harness();
  await service.approveCliDevice(request(), approvalBody);
  state.beforePersistence = () => { state.activeContestId = 3; };
  await assert.rejects(service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "CONTEST_CHANGED", status: 409 });
  assert.equal(state.persisted.length, 0);
  assert.equal(state.submissions.length, 0);
  assert.equal(state.locks.length, 2, "Both approval and final submission persistence take the shared lock.");
  assert(state.locks.every((sql) => sql.includes("pg_advisory_xact_lock_shared")));
});

test("final device persistence also rejects a revoked account or private grant after initial authorization", async () => {
  for (const reason of ["role", "proctoring", "grant"] as const) {
    const { service, state, user, contest } = harness(true);
    await service.approveCliDevice(request(), { ...approvalBody, contestPassword: "contest secret" });
    state.beforePersistence = () => {
      if (reason === "role") user.role = "JUDGE";
      if (reason === "proctoring") user.proctoringKeyHash = "locked";
      if (reason === "grant") contest.password = "rotated";
    };
    await assert.rejects(service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "REAUTH_REQUIRED" });
    assert.equal(state.persisted.length, 0);
  }
});

test("role changes, proctoring binding, and private-password rotation revoke approved devices dynamically", async () => {
  for (const reason of ["role", "proctoring", "contestPassword"] as const) {
    const { service, user, contest, state } = harness(true);
    await service.approveCliDevice(request(), { ...approvalBody, contestPassword: "contest secret" });
    if (reason === "role") user.role = "JUDGE";
    if (reason === "proctoring") user.proctoringKeyHash = "locked";
    if (reason === "contestPassword") contest.password = "rotated";
    const status = await service.getCliDevice(request());
    assert.equal(status.status, "disabled");
    assert.equal(status.code, "REAUTH_REQUIRED");
    await assert.rejects(service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "REAUTH_REQUIRED" });
    assert.equal(state.submissions.length, 0);
  }
});

test("a private device submits with its real signed contest grant and password rotation immediately blocks reuse", async () => {
  const { service, contest, state } = harness(true);
  await service.approveCliDevice(request(), { ...approvalBody, contestPassword: "contest secret" });
  await service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" });
  const grant = state.submissions[0].contestAccessToken as string;
  assert.equal(await grants.verifyContestAccessToken(grant, contest, secret), true);
  assert.equal(await grants.verifyContestAccessToken(grant, { ...contest, id: 3 }, secret), false);
  contest.password = "new contest password";
  assert.equal(await grants.verifyContestAccessToken(grant, contest, secret), false);
  await assert.rejects(service.submitCliDevice(request(), { problem: "A", language: "cpp", code: "int main(){}" }), { code: "REAUTH_REQUIRED" });
  assert.equal(state.submissions.length, 1);
});

test("pairing and approval limits use separate hashed IP/code buckets and return retry guidance", async () => {
  const seen: string[] = [];
  let count = 20;
  const limiter = loadModule<typeof import("./cli-rate-limit")>("lib/cli-rate-limit.ts", {
    "node:crypto": { createHash },
    "@/lib/redis": { redis: { eval: async (_script: string, _numberOfKeys: number, key: string) => { seen.push(key); return count; } } },
    "@/lib/request-ip": { getPrimaryClientIp: () => "192.0.2.44" },
    "@/lib/cli-device-policy": policy,
  });
  await limiter.enforceCliRateLimit(request(), "pair");
  count = 21;
  await assert.rejects(limiter.enforceCliRateLimit(request(), "pair"), { code: "RATE_LIMITED", status: 429 });
  count = 10;
  await limiter.enforceCliRateLimit(request(), "approve", "ABCD-EFGH");
  count = 11;
  await assert.rejects(limiter.enforceCliRateLimit(request(), "approve", "ABCD-EFGH"), { code: "RATE_LIMITED", status: 429 });
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[2], seen[3]);
  assert.notEqual(seen[0], seen[2]);
  assert(!seen.join("").includes("192.0.2.44"));
  assert(!seen.join("").includes("ABCD-EFGH"));
  const response = harness().service.cliErrorResponse(new policy.CliDeviceError("Wait", 429, "RATE_LIMITED"));
  assert.equal(response.headers.get("retry-after"), "60");
});

test("pending and approved expiry are enforced, invalid tokens fail, and logout revokes the device", async () => {
  const { service, device, state } = harness();
  device.pairingExpiresAt = new Date(Date.now() - 1000);
  assert.equal((await service.getCliDevice(request())).status, "expired");
  await assert.rejects(service.approveCliDevice(request(), approvalBody), { code: "DEVICE_EXPIRED" });
  device.pairingExpiresAt = new Date(Date.now() + 60_000);
  await service.approveCliDevice(request(), approvalBody);
  device.expiresAt = new Date(Date.now() - 1000);
  assert.equal((await service.getCliDevice(request())).status, "expired");
  await assert.rejects(service.getCliDevice(request(`njcli_${"b".repeat(43)}`)), { code: "INVALID_DEVICE_TOKEN" });
  await service.revokeCliDevice(request());
  assert.equal(state.device, null);
  await assert.rejects(service.getCliDevice(request()), { code: "INVALID_DEVICE_TOKEN" });
});

test("admin settings reject unauthenticated requests without querying or changing settings", async () => {
  const service = harness().service;
  const route = loadModule<{ GET(): Promise<Response>; PUT(request: Request): Promise<Response> }>("app/api/admin/cli-settings/route.ts", {
    "@/lib/auth": { getCurrentSuper: async () => null },
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("Unauthorized database access"); } }) },
    "@/lib/cli-device-policy": policy,
    "@/lib/cli-devices": service,
    "@/lib/cli-settings-lock": { lockCliSettings },
  });
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.PUT(new Request(`${base}/api/admin/cli-settings`, { method: "PUT", body: "{}" }))).status, 401);
});

test("ordinary web submissions keep their default persistence and judge only after an optional transaction commits", async () => {
  const events: string[] = [];
  const saved: Submission = {
    id: "saved", displayId: 1, contestId: 2, problemId: 1, userId: "team-id", globalUserId: null, virtualParticipationId: null,
    language: "cpp", code: "int main(){}", codeLength: 12, verdict: "PENDING", errorMessage: null,
    passedTests: 0, totalTests: 0, timeUsed: null, memoryUsed: null, submittedAt: new Date(),
  };
  const submissionService = loadModule<typeof import("./contest-submission")>("lib/contest-submission.ts", {
    "@/lib/generated/prisma/client": { ContestRole: { TEAM: "TEAM" }, Verdict: { PENDING: "PENDING", SYSTEM_ERROR: "SYSTEM_ERROR" } },
    "@/lib/prisma": { prisma: {
      contestProblem: { findFirst: async () => ({ problemId: 1, problem: { title: "A+B" }, contest: {
        id: 2, type: "PUBLIC", config: null, startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
      } }) },
      user: { findUnique: async () => ({ contestId: 2, role: "TEAM" }) },
      submission: {
        findFirst: async () => null,
        create: async () => { events.push("default insert"); return saved; },
        update: async () => { throw new Error("Unexpected judge failure update"); },
      },
    } },
    "@/lib/queue": { enqueueJudge: async () => { events.push("enqueue"); } },
    "@/lib/redis": { redis: { incr: async () => 1 } },
    "@/lib/auth": { getJwtSecretKey: () => secret },
    "@/lib/contest-access": { hasContestAccess: async () => true },
    "@/lib/contest-access-token": grants,
    "@/lib/virtual-participation": {},
  });
  const input = { contestId: 2, problemDisplayId: "A", language: "cpp", code: "int main(){}", actor: { type: "contest" as const, userId: "team-id", role: "TEAM" } };
  await submissionService.createContestSubmission(input);
  assert.deepEqual(events, ["default insert", "enqueue"]);
  events.length = 0;
  await submissionService.createContestSubmission({ ...input, persistSubmission: async (data) => {
    assert.equal(data.contestId, 2);
    assert.equal(data.userId, "team-id");
    events.push("transaction insert");
    await Promise.resolve();
    events.push("transaction commit");
    return saved;
  } });
  assert.deepEqual(events, ["transaction insert", "transaction commit", "enqueue"]);
  events.length = 0;
  await assert.rejects(submissionService.createContestSubmission({ ...input, persistSubmission: async () => {
    throw new policy.CliDeviceError("Contest changed", 409, "CONTEST_CHANGED");
  } }), { code: "CONTEST_CHANGED" });
  assert.deepEqual(events, [], "A rejected persistence hook must not write or enqueue.");
});
