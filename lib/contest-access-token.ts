import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const CONTEST_ACCESS_COOKIE_PREFIX = "contest_access_";
export const CONTEST_ACCESS_MAX_AGE = 24 * 60 * 60;
const ISSUER = "novajudge:contest-access";

type ContestCredential = { id: number; password: string | null };

export function contestAccessCookieName(contestId: number) {
  return `${CONTEST_ACCESS_COOKIE_PREFIX}${contestId}`;
}

export function matchesContestPassword(input: string, password: string | null) {
  if (!input || !password) return false;
  return timingSafeEqual(
    createHash("sha256").update(input).digest(),
    createHash("sha256").update(password).digest(),
  );
}

function credentialVersion(contest: ContestCredential, secret: Uint8Array) {
  // A keyed digest binds the grant to the current password without exposing a
  // password hash that could be attacked offline by decoding the JWT.
  return createHmac("sha256", secret)
    .update(JSON.stringify([contest.id, contest.password]))
    .digest("hex");
}

export async function signContestAccessToken(
  contest: ContestCredential,
  secret: Uint8Array,
  maxAgeSeconds = CONTEST_ACCESS_MAX_AGE,
) {
  if (!contest.password) throw new Error("Private contest password is not configured");
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new Error("Invalid contest access duration");
  return new SignJWT({ credential: credentialVersion(contest, secret) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(`contest:${contest.id}`)
    .setSubject(String(contest.id))
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret);
}

export async function verifyContestAccessToken(
  token: string,
  contest: ContestCredential,
  secret: Uint8Array,
): Promise<boolean> {
  if (!contest.password || !token) return false;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: `contest:${contest.id}`,
      requiredClaims: ["sub", "iat", "exp", "credential"],
    });
    return (
      payload.sub === String(contest.id) &&
      payload.credential === credentialVersion(contest, secret)
    );
  } catch {
    return false;
  }
}
