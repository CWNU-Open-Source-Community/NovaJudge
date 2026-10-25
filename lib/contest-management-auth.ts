import { cookies } from "next/headers";
import { getCurrentSuper, verifyAuth } from "./auth";
import { hasContestAccess } from "./contest-access";
import { prisma } from "./prisma";

export interface ContestManager {
  key: string;
  userId: string;
  isGlobalAdmin: boolean;
}

/** Reading a management page and invoking its actions use the same current role. */
export async function getContestManager(contestId: number): Promise<ContestManager | null> {
  if (!Number.isSafeInteger(contestId) || contestId <= 0) return null;
  if (!(await hasContestAccess(contestId))) return null;

  const globalUser = await getCurrentSuper();
  if (globalUser?.isGlobalAdmin) {
    return { key: `global-${globalUser.userId}`, userId: globalUser.userId, isGlobalAdmin: true };
  }

  const token = (await cookies()).get("user_token")?.value;
  if (!token) return null;
  const payload = await verifyAuth(token).catch(() => null);
  if (!payload?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: String(payload.userId) },
    select: { id: true, contestId: true, role: true },
  });
  if (!user || user.contestId !== contestId || !["ADMIN", "JUDGE"].includes(user.role)) {
    return null;
  }
  return { key: `contest-${user.id}`, userId: user.id, isGlobalAdmin: false };
}

export async function requireContestManager(contestId: number): Promise<ContestManager> {
  const manager = await getContestManager(contestId);
  if (!manager) throw new Error("无权管理本场比赛，请使用本场管理员或裁判账号登录。");
  return manager;
}
