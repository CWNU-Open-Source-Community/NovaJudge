import { getCurrentSuper, getCurrentUser } from "./auth";
import { hasContestAccess } from "./contest-access";
import { prisma } from "./prisma";
import { zh } from "./dictionaries";

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
  if (globalUser) {
    if (globalUser.isGlobalAdmin) {
      return { key: `global-${globalUser.userId}`, userId: globalUser.userId, isGlobalAdmin: true };
    }
    // A current global session must not inherit an older contest cookie's role.
    return null;
  }

  const payload = await getCurrentUser();
  if (!payload?.userId || payload.contestId !== contestId) return null;

  const user = await prisma.user.findUnique({
    where: { id: String(payload.userId) },
    select: { id: true, contestId: true, role: true },
  });
  if (!user || user.contestId !== contestId || !["ADMIN", "JUDGE"].includes(user.role)) {
    return null;
  }
  return { key: `contest-${user.id}`, userId: user.id, isGlobalAdmin: false };
}

export async function requireContestManager(contestId: number, message = zh.rejudge.managerRequired): Promise<ContestManager> {
  const manager = await getContestManager(contestId);
  if (!manager) throw new Error(message);
  return manager;
}
