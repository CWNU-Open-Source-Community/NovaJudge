"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { ContestConfig } from "@/app/(main)/page";

export async function unfreezeContest(contestId: number) {
  await requireContestAccess(contestId);
  const globalUser = await getCurrentSuper();
  const isGlobalAdmin = !!globalUser?.isGlobalAdmin;
  let isContestAdmin = false;

  const payload = await getCurrentUser();
  if (payload) {
    if (payload?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });
      if (
        user &&
        user.contestId === contestId &&
        user.role === ContestRole.ADMIN
      ) {
        isContestAdmin = true;
      }
    }
  }

  if (!isGlobalAdmin && !isContestAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const contest = await prisma.contest.findUnique({
      where: { id: contestId },
      select: { config: true },
    });

    if (!contest) return { success: false, error: "Contest not found" };

    const newConfig = {
      ...(contest.config as ContestConfig),
      frozenDuration: 0,
    } as ContestConfig; // Cast as any because Json type compatibility can be tricky

    await prisma.contest.update({
      where: { id: contestId },
      data: { config: newConfig },
    });

    revalidatePath(`/contest/${contestId}/rank`);
    return { success: true };
  } catch (error) {
    console.error("Unfreeze error:", error);
    return { success: false, error: "Failed to update contest" };
  }
}
