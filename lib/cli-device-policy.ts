import { createHash, randomBytes } from "node:crypto";

export const CLI_PAIRING_SECONDS = 10 * 60;
export const CLI_DEVICE_SECONDS = 30 * 24 * 60 * 60;

export class CliDeviceError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "CliDeviceError";
  }
}

export function generateCliCredentials() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Use rejection sampling so code symbols remain equally likely.
  let code = "";
  while (code.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte < Math.floor(256 / alphabet.length) * alphabet.length) code += alphabet[byte % alphabet.length];
      if (code.length === 8) break;
    }
  }
  const deviceToken = `njcli_${randomBytes(32).toString("base64url")}`;
  return { deviceToken, tokenHash: cliTokenHash(deviceToken), userCode: `${code.slice(0, 4)}-${code.slice(4)}` };
}

export function cliTokenHash(token: string) {
  if (!/^njcli_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new CliDeviceError("Invalid device token. Run submit login again.", 401, "INVALID_DEVICE_TOKEN");
  }
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeCliUserCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase().replace(/-/g, "") : "";
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new CliDeviceError("Invalid pairing code.", 400, "INVALID_CODE");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export type CliDeviceStatus = "pending" | "ready" | "expired" | "contest_changed" | "disabled";
export type CliDeviceState = { status: CliDeviceStatus; code?: string };

export function cliDeviceState(
  device: {
    contestId: number;
    pairingExpiresAt: Date;
    expiresAt: Date;
    approvedAt: Date | null;
    proctoringKeyHash?: string | null;
    user: { contestId: number; role: string; proctoringKeyHash: string | null } | null;
  },
  activeContestId: number | null,
  privateGrantValid = true,
  now = new Date(),
): CliDeviceState {
  if (activeContestId === null) return { status: "disabled", code: "CLI_DISABLED" };
  if (activeContestId !== device.contestId) return { status: "contest_changed", code: "CONTEST_CHANGED" };
  if (device.expiresAt <= now || (!device.approvedAt && device.pairingExpiresAt <= now)) return { status: "expired", code: "DEVICE_EXPIRED" };
  if (!device.approvedAt) return { status: "pending" };
  // Ordinary browser grants never gain access when an account becomes monitored.
  // A monitor-issued grant is valid only for the exact monitored login that issued it.
  const sameProctoringLogin = device.proctoringKeyHash
    ? device.proctoringKeyHash === device.user?.proctoringKeyHash
    : !device.user?.proctoringKeyHash;
  if (!device.user || device.user.contestId !== device.contestId || device.user.role !== "TEAM" || !sameProctoringLogin || !privateGrantValid) {
    return { status: "disabled", code: "REAUTH_REQUIRED" };
  }
  return { status: "ready" };
}

export function assertSameOriginJson(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new CliDeviceError("Use an application/json request.", 415, "JSON_REQUIRED");
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  let sameOrigin = false;
  try {
    const requestUrl = new URL(request.url);
    // Next.js can construct request.url from its listening hostname (localhost)
    // rather than the browser's LAN IP or public hostname. Follow Next's host
    // precedence: the proxy's first forwarded host, then Host, then the URL.
    // A reverse proxy must overwrite forwarded headers from external clients.
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost !== null
      ? forwardedHost.split(",")[0].trim()
      : request.headers.get("host") ?? requestUrl.host;
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto !== null
      ? forwardedProto.split(",")[0].trim() + ":"
      : requestUrl.protocol;
    if (origin && host && !/[\s/\\?#@,]/.test(host) && ["http:", "https:"].includes(protocol)) {
      const source = new URL(origin);
      const target = new URL(`${protocol}//${host}`);
      sameOrigin = ["http:", "https:"].includes(source.protocol) &&
        !source.username && !source.password && !source.search && !source.hash &&
        source.pathname === "/" && source.origin === target.origin;
    }
  } catch { /* Invalid Origin / forwarding headers fail closed. */ }
  if (!sameOrigin || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    throw new CliDeviceError("This action must be requested from the NovaJudge site.", 403, "SAME_ORIGIN_REQUIRED");
  }
}
