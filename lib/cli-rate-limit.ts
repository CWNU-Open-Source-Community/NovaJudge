import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";
import { getPrimaryClientIp } from "@/lib/request-ip";
import { CliDeviceError } from "@/lib/cli-device-policy";

const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count
`;

export async function enforceCliRateLimit(request: Request, action: "pair" | "approve", userCode = "") {
  const ip = getPrimaryClientIp(request.headers) || "unknown";
  const identity = createHash("sha256").update(JSON.stringify([ip, userCode])).digest("hex");
  const limit = action === "pair" ? 20 : 10;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let count: number;
  try {
    count = Number(await Promise.race([
      redis.eval(INCREMENT_WINDOW, 1, `cli:rate:${action}:${identity}`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Rate-limit service timeout")), 3000);
      }),
    ]));
  } catch {
    throw new CliDeviceError("The pairing service is temporarily unavailable. Try again shortly.", 503, "PAIRING_UNAVAILABLE");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (count > limit) throw new CliDeviceError("Too many pairing requests. Try again in one minute.", 429, "RATE_LIMITED");
}
