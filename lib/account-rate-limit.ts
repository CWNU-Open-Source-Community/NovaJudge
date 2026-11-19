import { judgeQueueConnection } from "@/lib/queue";

export const REQUESTS_PER_MINUTE = 10;
type AccountAction = "submission" | "print";

// The tenth most recent request determines when the next slot opens. A list
// counts simultaneous requests separately even when their timestamps match.
const RESERVE_REQUEST = `
local limit = tonumber(ARGV[1])
local windowMs = 60000
local time = redis.call('TIME')
local nowMs = time[1] * 1000 + math.floor(time[2] / 1000)
local oldest = redis.call('LINDEX', KEYS[1], limit - 1)
if oldest then
  local waitMs = tonumber(oldest) + windowMs - nowMs
  if waitMs > 0 then return math.ceil(waitMs / 1000) end
end
redis.call('LPUSH', KEYS[1], nowMs)
redis.call('LTRIM', KEYS[1], 0, limit - 1)
redis.call('PEXPIRE', KEYS[1], windowMs)
return 0
`;

export class AccountRateLimitError extends Error {
  readonly code = "rateLimited";

  constructor(action: AccountAction, readonly retryAfterSeconds: number) {
    const requests = action === "print" ? "print requests" : "code submissions";
    super(`Each account can send up to ${REQUESTS_PER_MINUTE} ${requests} per minute. Try again in ${retryAfterSeconds}s.`);
  }
}

export async function enforceAccountRateLimit(
  action: AccountAction,
  accountId: string,
  accountType: "contest" | "global" = "contest",
) {
  const key = `${action}:rate:${accountType}:${accountId}`;
  const retryAfter = await judgeQueueConnection.eval(RESERVE_REQUEST, 1, key, REQUESTS_PER_MINUTE);
  if (typeof retryAfter !== "number") throw new Error("Invalid account rate limit response.");
  if (retryAfter > 0) throw new AccountRateLimitError(action, retryAfter);
}
