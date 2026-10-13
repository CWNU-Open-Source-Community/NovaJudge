import { createHash, timingSafeEqual } from "node:crypto";

export const PROCTORING_HEADER = "x-novajudge-proctor-key";
export const PROCTORING_REQUIRED = "请通过监考客户端登录并访问本场比赛。";

export function proctoringKeyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// The database binding revokes earlier ordinary-browser sessions and previous
// proctoring sessions. A JWT alone cannot be copied into a browser for access.
export function proctoringAccessAllowed(
  storedHash: string | null,
  payload: { loginSource?: string; proctoringKeyHash?: string },
  accessKey: string | null,
) {
  if (!storedHash) return payload.loginSource !== "PROCTORING" && !payload.proctoringKeyHash;
  if (payload.loginSource !== "PROCTORING" || payload.proctoringKeyHash !== storedHash
    || !accessKey || !/^[A-Za-z0-9_-]{43}$/.test(accessKey) || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(proctoringKeyHash(accessKey), "hex"), Buffer.from(storedHash, "hex"));
}
