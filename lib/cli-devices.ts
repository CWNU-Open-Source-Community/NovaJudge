import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getJwtSecretKey, verifyAuth } from "@/lib/auth";
import { decodeJwt } from "jose";
import { hasContestAccess } from "@/lib/contest-access";
import { matchesContestPassword, signContestAccessToken, verifyContestAccessToken } from "@/lib/contest-access-token";
import { getPrimaryClientIp } from "@/lib/request-ip";
import { createContestSubmission } from "@/lib/contest-submission";
import { enforceCliRateLimit } from "@/lib/cli-rate-limit";
import { lockCliSettings } from "@/lib/cli-settings-lock";
import { assertCliEnabled, isCliEnabled } from "@/lib/cli-deployment";
import { proctoringAccessAllowed, PROCTORING_HEADER } from "@/lib/proctoring-access";
import { validatePrintFile } from "@/lib/print-file-policy";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  CLI_DEVICE_SECONDS, CLI_PAIRING_SECONDS, CliDeviceError,
  cliDeviceState, cliTokenHash, generateCliCredentials, normalizeCliUserCode,
  type CliDeviceState,
} from "@/lib/cli-device-policy";

export { CliDeviceError } from "@/lib/cli-device-policy";
export const CLI_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

const contestSelect = { id: true, title: true, type: true, password: true } as const;
const deviceInclude = {
  contest: { select: contestSelect },
  user: { select: { id: true, username: true, displayName: true, contestId: true, role: true, proctoringKeyHash: true } },
} as const;

export function cliJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CLI_RESPONSE_HEADERS });
}

export async function readCliJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CliDeviceError("A JSON object is required.", 400, "INVALID_JSON");
  return body as Record<string, unknown>;
}

export function cliErrorResponse(error: unknown) {
  if (error instanceof CliDeviceError) {
    const response = cliJson({ error: error.message, code: error.code }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  if (error instanceof SyntaxError) return cliJson({ error: "Invalid JSON request.", code: "INVALID_JSON" }, 400);
  // ORM errors can include their arguments. Keep grants and credentials out of logs.
  console.error("CLI device request failed:", error instanceof Error ? error.name : "Unknown error");
  return cliJson({ error: "Internal server error.", code: "INTERNAL_ERROR" }, 500);
}

export async function activeCliContest(db: Prisma.TransactionClient = prisma) {
  if (!isCliEnabled()) return null;
  const settings = await db.cliSettings.findUnique({ where: { id: 1 }, select: { activeContest: { select: contestSelect } } });
  return settings?.activeContest ?? null;
}

export async function assertActiveCliContest(contestId: number, db: Prisma.TransactionClient = prisma) {
  assertCliEnabled();
  const contest = await activeCliContest(db);
  if (!contest) throw new CliDeviceError("The administrator has not selected a CLI contest.", 409, "CLI_DISABLED");
  if (contest.id !== contestId) throw new CliDeviceError("The active CLI contest changed. Sign in for the selected contest again.", 409, "CONTEST_CHANGED");
  return contest;
}

function displayContest(contest: { id: number; title: string; type: string }, allowed = false) {
  return { id: contest.id, title: contest.type === "PRIVATE" && !allowed ? "Private contest" : contest.title };
}

export async function publicCliSettings() {
  const contest = await activeCliContest();
  return { enabled: isCliEnabled(), contest: contest ? displayContest(contest, contest.type === "PUBLIC" || await hasContestAccess(contest.id)) : null };
}

export async function createCliDevice(request: Request) {
  assertCliEnabled();
  await enforceCliRateLimit(request, "pair");
  const contest = await activeCliContest();
  if (!contest) throw new CliDeviceError("The administrator has not selected a CLI contest.", 409, "CLI_DISABLED");
  // Keep recently expired codes readable for browser error messages, then
  // discard abandoned pairing records on subsequent pairing requests.
  await prisma.cliDevice.deleteMany({ where: { approvedAt: null, pairingExpiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const credentials = generateCliCredentials();
    const now = Date.now();
    const pairingExpiresAt = new Date(now + CLI_PAIRING_SECONDS * 1000);
    try {
      await prisma.cliDevice.create({ data: {
        tokenHash: credentials.tokenHash,
        userCode: credentials.userCode,
        contestId: contest.id,
        pairingExpiresAt,
        expiresAt: new Date(now + CLI_DEVICE_SECONDS * 1000),
      } });
      return {
        deviceToken: credentials.deviceToken,
        userCode: credentials.userCode,
        verificationPath: `/cli/connect?code=${encodeURIComponent(credentials.userCode)}`,
        expiresAt: pairingExpiresAt.toISOString(),
        pollInterval: 2,
        contest: displayContest(contest),
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new CliDeviceError("Could not allocate a pairing code. Try again.", 503, "PAIRING_UNAVAILABLE");
}

export async function createProctoringCliDevice(request: Request) {
  assertCliEnabled();
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new CliDeviceError("A monitored login Bearer token is required.", 401, "PROCTORING_AUTH_REQUIRED");
  let payload;
  try { payload = await verifyAuth(token); }
  catch { throw new CliDeviceError("The monitored login expired. Sign in through the proctoring client again.", 401, "PROCTORING_AUTH_REQUIRED"); }
  if (!payload.userId || !Number.isSafeInteger(payload.contestId) || !payload.contestId || payload.isGlobalAdmin ||
      payload.role !== "TEAM" || payload.loginSource !== "PROCTORING" || !payload.proctoringKeyHash ||
      typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= Date.now()) {
    throw new CliDeviceError("A current monitored team login is required.", 403, "PROCTORING_CLIENT_REQUIRED");
  }
  const proof = request.headers.get(PROCTORING_HEADER);
  // Verified team identities get separate buckets: an entire contest room can
  // share one egress IP and sign in at the same time.
  await enforceCliRateLimit(request, "pair", `proctoring:${payload.userId}`);
  // The admin contest switch uses the exclusive side of this same lock.
  return prisma.$transaction(async (tx) => {
    await lockCliSettings(tx, "shared");
    const contest = await activeCliContest(tx);
    if (!contest) throw new CliDeviceError("The administrator has not selected a CLI contest.", 409, "CLI_DISABLED");
    if (contest.id !== payload.contestId) throw new CliDeviceError("The monitored login does not belong to the administrator's current CLI contest.", 409, "CONTEST_CHANGED");
    const user = await tx.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, displayName: true, role: true, contestId: true, proctoringKeyHash: true },
    });
    if (!user || user.role !== "TEAM" || user.contestId !== contest.id ||
        !proctoringAccessAllowed(user.proctoringKeyHash, payload, proof)) {
      throw new CliDeviceError("The monitored login is no longer valid. Sign in through the proctoring client again.", 403, "PROCTORING_CLIENT_REQUIRED");
    }
    const now = new Date();
    let expiresAt = new Date(Math.min(payload.exp! * 1000, now.getTime() + CLI_DEVICE_SECONDS * 1000));
    let contestAccessToken: string | null = null;
    if (contest.type === "PRIVATE") {
      contestAccessToken = request.headers.get("x-contest-access-token");
      if (!await verifyContestAccessToken(contestAccessToken || "", contest, getJwtSecretKey())) {
        throw new CliDeviceError("The private contest authorization expired. Sign in through the proctoring client again.", 403, "CONTEST_PASSWORD_REQUIRED");
      }
      // Decode only after signature, audience, password version and expiry validation.
      expiresAt = new Date(Math.min(expiresAt.getTime(), decodeJwt(contestAccessToken!).exp! * 1000));
    }
    if (expiresAt <= now) throw new CliDeviceError("The monitored login expired. Sign in through the proctoring client again.", 401, "PROCTORING_AUTH_REQUIRED");
    // The stored device token hash is the only secret needed by CLI APIs;
    // the monitor's full JWT and access key are never copied into this record.
    const credentials = generateCliCredentials();
    await tx.cliDevice.create({ data: {
      tokenHash: credentials.tokenHash, userCode: credentials.userCode,
      contestId: contest.id, userId: user.id, proctoringKeyHash: user.proctoringKeyHash,
      contestAccessToken, approvedAt: now, pairingExpiresAt: now, expiresAt,
    } });
    return {
      deviceToken: credentials.deviceToken, loginSource: "PROCTORING" as const,
      contest: displayContest(contest, true),
      user: { username: user.username, displayName: user.displayName }, expiresAt: expiresAt.toISOString(),
    };
  });
}

function tokenFromRequest(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new CliDeviceError("A device Bearer token is required.", 401, "INVALID_DEVICE_TOKEN");
  return token;
}

async function deviceFromRequest(request: Request, db: Prisma.TransactionClient = prisma) {
  const device = await db.cliDevice.findUnique({ where: { tokenHash: cliTokenHash(tokenFromRequest(request)) }, include: deviceInclude });
  if (!device) throw new CliDeviceError("Unknown or revoked device. Run submit login again.", 401, "INVALID_DEVICE_TOKEN");
  return device;
}

type LoadedDevice = NonNullable<Awaited<ReturnType<typeof deviceFromRequest>>>;

async function stateOf(device: LoadedDevice, db: Prisma.TransactionClient = prisma) {
  const active = await activeCliContest(db);
  const grantValid = !device.approvedAt || device.contest.type === "PUBLIC" || await verifyContestAccessToken(device.contestAccessToken || "", device.contest, getJwtSecretKey());
  return cliDeviceState(device, active?.id ?? null, grantValid);
}

export async function getCliDevice(request: Request) {
  assertCliEnabled();
  const device = await deviceFromRequest(request);
  const state = await stateOf(device);
  return {
    ...state,
    loginSource: device.proctoringKeyHash ? "PROCTORING" as const : "BROWSER" as const,
    expiresAt: device.expiresAt.toISOString(),
    contest: displayContest(device.contest, state.status === "ready"),
    ...(state.status === "ready" && device.user ? { user: { username: device.user.username, displayName: device.user.displayName } } : {}),
  };
}

export async function revokeCliDevice(request: Request) {
  const tokenHash = cliTokenHash(tokenFromRequest(request));
  const deleted = await prisma.cliDevice.deleteMany({ where: { tokenHash } });
  if (!deleted.count) throw new CliDeviceError("Unknown or revoked device.", 401, "INVALID_DEVICE_TOKEN");
  return { success: true };
}

function throwForState(state: CliDeviceState) {
  if (state.status === "contest_changed") throw new CliDeviceError("The active contest changed. Run submit login to bind this computer again.", 409, "CONTEST_CHANGED");
  if (state.code === "CLI_DISABLED") throw new CliDeviceError("The administrator has not selected a CLI contest.", 409, "CLI_DISABLED");
  if (state.status === "expired") throw new CliDeviceError("This device authorization expired. Run submit login again.", 410, "DEVICE_EXPIRED");
  if (state.status === "disabled") throw new CliDeviceError("This device authorization is no longer valid. Bind this computer again.", 403, "REAUTH_REQUIRED");
  if (state.status === "pending") throw new CliDeviceError("Complete this computer's approval in the browser first.", 409, "PAIRING_REQUIRED");
}

export async function cliApprovalDetails(code: unknown) {
  assertCliEnabled();
  const device = await prisma.cliDevice.findUnique({ where: { userCode: normalizeCliUserCode(code) }, include: deviceInclude });
  if (!device) throw new CliDeviceError("Pairing code not found. Run submit login to obtain a new code.", 404, "INVALID_CODE");
  const state = await stateOf(device);
  const allowed = device.contest.type === "PUBLIC" || await hasContestAccess(device.contestId);
  return {
    userCode: device.userCode,
    contest: { ...displayContest(device.contest, allowed), type: device.contest.type },
    expiresAt: device.pairingExpiresAt.toISOString(),
    ...state,
  };
}

export async function approveCliDevice(request: Request, body: Record<string, unknown>) {
  assertCliEnabled();
  const userCode = normalizeCliUserCode(body.code);
  await enforceCliRateLimit(request, "approve", userCode);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) throw new CliDeviceError("Username and password are required.", 400, "CREDENTIALS_REQUIRED");
  const device = await prisma.cliDevice.findUnique({ where: { userCode }, include: deviceInclude });
  if (!device) throw new CliDeviceError("Pairing code not found.", 404, "INVALID_CODE");
  const state = await stateOf(device);
  if (state.status !== "pending") {
    if (device.approvedAt && state.status === "ready") throw new CliDeviceError("This code has already been approved.", 409, "ALREADY_APPROVED");
    throwForState(state);
  }
  if (device.approvedAt) throw new CliDeviceError("This code has already been approved.", 409, "ALREADY_APPROVED");
  const user = await prisma.user.findUnique({ where: { contestId_username: { contestId: device.contestId, username } } });
  if (!user || !(await bcrypt.compare(password, user.password))) throw new CliDeviceError("Invalid username or password for the active contest.", 401, "INVALID_CREDENTIALS");
  if (user.role !== "TEAM") throw new CliDeviceError("Only team accounts can bind a submission client.", 403, "TEAM_REQUIRED");
  if (user.proctoringKeyHash) throw new CliDeviceError("This account must use the proctoring client.", 403, "PROCTORING_CLIENT_REQUIRED");
  let contestAccessToken: string | null = null;
  if (device.contest.type === "PRIVATE") {
    if (!matchesContestPassword(typeof body.contestPassword === "string" ? body.contestPassword : "", device.contest.password)) {
      throw new CliDeviceError("Provide the correct contest password.", 403, "CONTEST_PASSWORD_REQUIRED");
    }
    contestAccessToken = await signContestAccessToken(device.contest, getJwtSecretKey(), CLI_DEVICE_SECONDS);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await lockCliSettings(tx, "shared");
    assertCliEnabled();
    const settings = await tx.cliSettings.findUnique({ where: { id: 1 }, select: { activeContestId: true } });
    if (settings?.activeContestId !== device.contestId) throw new CliDeviceError("The active contest changed. Obtain a new pairing code.", 409, "CONTEST_CHANGED");
    // Recheck the account after password verification, then claim the code once.
    const currentUser = await tx.user.findUnique({ where: { id: user.id }, select: { role: true, contestId: true, proctoringKeyHash: true, password: true } });
    if (!currentUser || currentUser.role !== "TEAM" || currentUser.contestId !== device.contestId || currentUser.proctoringKeyHash || currentUser.password !== user.password) {
      throw new CliDeviceError("Account authorization changed. Sign in again.", 403, "REAUTH_REQUIRED");
    }
    const claimed = await tx.cliDevice.updateMany({
      where: { id: device.id, approvedAt: null, userId: null, pairingExpiresAt: { gt: now }, expiresAt: { gt: now } },
      data: { userId: user.id, approvedAt: now, expiresAt: new Date(now.getTime() + CLI_DEVICE_SECONDS * 1000), contestAccessToken },
    });
    if (!claimed.count) throw new CliDeviceError("This pairing code was already used or expired.", 409, "ALREADY_APPROVED");
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now, lastLoginIp: getPrimaryClientIp(request.headers) || "unknown" } });
  });
  return { success: true, contest: displayContest(device.contest, true), user: { username: user.username, displayName: user.displayName } };
}

export async function submitCliDevice(request: Request, body: Record<string, unknown>) {
  assertCliEnabled();
  const device = await deviceFromRequest(request);
  throwForState(await stateOf(device));
  if (!device.user) throw new CliDeviceError("Bind a team account first.", 403, "REAUTH_REQUIRED");
  const problemDisplayId = typeof body.problem === "string" ? body.problem.trim().toUpperCase() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!problemDisplayId || !language || !code) throw new CliDeviceError("problem, language and code are required.", 400, "INVALID_SUBMISSION");
  if (!["c", "cpp", "java", "pypy3"].includes(language)) throw new CliDeviceError("Unsupported submission language.", 400, "INVALID_LANGUAGE");
  let submission;
  try {
    submission = await createContestSubmission({
      contestId: device.contestId,
      contestAccessToken: device.contestAccessToken || undefined,
      problemDisplayId, language, code,
      actor: { type: "contest", userId: device.user.id, role: device.user.role, isGlobalAdmin: false },
      persistSubmission: (data) => prisma.$transaction(async (tx) => {
        await lockCliSettings(tx, "shared");
        assertCliEnabled();
        const currentDevice = await deviceFromRequest(request, tx);
        throwForState(await stateOf(currentDevice, tx));
        if (currentDevice.contestId !== data.contestId || currentDevice.user?.id !== data.userId) {
          throw new CliDeviceError("The device binding changed. Run submit login again.", 409, "CONTEST_CHANGED");
        }
        return tx.submission.create({ data });
      }),
    });
  } catch (error) {
    if (error instanceof CliDeviceError) throw error;
    throw new CliDeviceError(error instanceof Error ? error.message : "Submission failed.", 400, "SUBMISSION_REJECTED");
  }
  return { success: true, submission, statusUrl: `/contest/${device.contestId}/status/${submission.displayId}` };
}

async function monitoredPrintDevice(request: Request, db: Prisma.TransactionClient = prisma) {
  assertCliEnabled();
  const device = await deviceFromRequest(request, db);
  // Only the server-issued monitoring grant qualifies. Request fields or the
  // presence of a monitoring header cannot upgrade an ordinary paired device.
  if (!device.proctoringKeyHash) {
    throw new CliDeviceError("Sign in through the proctoring client to use printfile.", 403, "PROCTORING_CLIENT_REQUIRED");
  }
  throwForState(await stateOf(device, db));
  if (!device.user || device.proctoringKeyHash !== device.user.proctoringKeyHash) {
    throw new CliDeviceError("Sign in through the proctoring client again.", 403, "REAUTH_REQUIRED");
  }
  return { device, user: device.user };
}

export async function getCliPrintContext(request: Request) {
  const { device, user } = await monitoredPrintDevice(request);
  return {
    loginSource: "PROCTORING" as const,
    contest: displayContest(device.contest, true),
    user: { username: user.username, displayName: user.displayName },
    expiresAt: device.expiresAt.toISOString(),
  };
}

export async function printCliDevice(request: Request, body: Record<string, unknown>) {
  const initial = await monitoredPrintDevice(request);
  const file = validatePrintFile(body);
  return prisma.$transaction(async (tx) => {
    // Serialize against the administrator's CLI contest switch and re-read
    // grants, private contest access and team identity immediately before write.
    await lockCliSettings(tx, "shared");
    const { device, user } = await monitoredPrintDevice(request, tx);
    if (device.contestId !== initial.device.contestId || user.id !== initial.user.id ||
        device.proctoringKeyHash !== initial.device.proctoringKeyHash) {
      throw new CliDeviceError("The monitored device binding changed. Sign in through the proctoring client again.", 403, "REAUTH_REQUIRED");
    }
    const printJob = await tx.printJob.create({
      data: { contestId: device.contestId, userId: user.id, ...file },
      select: { id: true, sourceFilename: true, language: true, status: true },
    });
    return { success: true, printJob, contest: displayContest(device.contest, true) };
  });
}
