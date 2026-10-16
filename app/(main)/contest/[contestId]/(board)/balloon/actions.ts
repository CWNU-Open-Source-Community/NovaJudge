"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import { ContestRole, Verdict } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function checkPermission(contestId: number) {
  await requireContestAccess(contestId);
  const user = await getCurrentUser();
  const superAdmin = await getCurrentSuper();
  if (!user && !superAdmin) return null;

  const contestUser = user as UserJwtPayload | null;
  const isSameContest = contestUser?.contestId === contestId;
  const isAdmin =
    (isSameContest &&
      (contestUser?.role === ContestRole.ADMIN ||
        contestUser?.role === ContestRole.JUDGE)) ||
    (superAdmin as UserJwtPayload)?.isGlobalAdmin;

  return isAdmin;
}

export async function syncBalloons(contestId: number) {
  const isAdmin = await checkPermission(contestId);
  if (!isAdmin) return;

  const acSubmissions = await prisma.submission.findMany({
    where: { contestId, verdict: Verdict.ACCEPTED },
    select: { id: true, userId: true, problemId: true },
  });

  let count = 0;
  for (const sub of acSubmissions) {
    const exists = await prisma.balloon.findUnique({
      where: { submissionId: sub.id },
    });
    if (exists) continue;

    const previousBalloon = await prisma.balloon.findFirst({
      where: {
        contestId,
        submission: { userId: sub.userId, problemId: sub.problemId },
      },
    });

    if (previousBalloon) continue;

    await prisma.balloon.create({
      data: { contestId, submissionId: sub.id, status: "PENDING" },
    });
    count++;
  }
  return count;
}

export async function generateBalloons(contestId: number) {
  const count = await syncBalloons(contestId);
  if (count && count > 0) revalidatePath(`/contest/${contestId}/balloon`);
}

export async function getBalloonData(contestId: number) {
  await requireContestAccess(contestId);
  const user = await getCurrentUser();
  const superAdmin = await getCurrentSuper();
  if (!user && !superAdmin) return { balloons: [], runners: [], role: null };

  const contestUser = user as UserJwtPayload | null;
  const role = contestUser?.contestId === contestId ? contestUser.role : null;
  const isMaster =
    role === ContestRole.ADMIN ||
    role === ContestRole.JUDGE ||
    (superAdmin as UserJwtPayload)?.isGlobalAdmin;

  if (!isMaster && (role !== ContestRole.BALLOON || !contestUser?.userId)) {
    return { balloons: [], runners: [], role: null };
  }

  const whereCondition: Prisma.BalloonWhereInput = { contestId };

  if (!isMaster) {
    whereCondition.assignedToId = contestUser?.userId;
  }

  const balloons = await prisma.balloon.findMany({
    where: whereCondition,
    include: {
      submission: {
        select: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              seat: true,
            },
          },
          problem: { select: { id: true } },
        },
      },
      assignedTo: { select: { displayName: true, username: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  type Runner = {
    id: string;
    displayName: string | null;
    username: string;
  };
  let runners: Runner[] = [];
  if (isMaster) {
    runners = await prisma.user.findMany({
      where: { contestId, role: { equals: ContestRole.BALLOON } },
      select: { id: true, displayName: true, username: true },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
    });
  }

  return {
    balloons,
    runners,
    isMaster,
    currentUserId:
      contestUser?.userId || (superAdmin as UserJwtPayload)?.userId,
  };
}

export async function assignBalloon(
  contestId: number,
  balloonId: number,
  runnerId: string
) {
  const isAdmin = await checkPermission(contestId);
  if (!isAdmin) return;

  const runner = await prisma.user.findFirst({
    where: { id: runnerId, contestId, role: ContestRole.BALLOON },
    select: { id: true },
  });
  if (!runner) {
    throw new Error("Runner must be a balloon volunteer in this contest.");
  }

  await prisma.balloon.updateMany({
    where: { id: balloonId, contestId },
    data: { assignedToId: runner.id, status: "ASSIGNED" },
  });
  revalidatePath(`/contest/${contestId}/balloon`);
}

export async function completeBalloon(contestId: number, balloonId: number) {
  await requireContestAccess(contestId);
  const user = (await getCurrentUser()) as UserJwtPayload | null;
  const superAdmin = await getCurrentSuper();
  const isMaster =
    (user?.contestId === contestId &&
      (user?.role === ContestRole.ADMIN || user?.role === ContestRole.JUDGE)) ||
    (superAdmin as UserJwtPayload)?.isGlobalAdmin;

  if (!isMaster && (!user?.userId || user.contestId !== contestId || user.role !== ContestRole.BALLOON)) {
    throw new Error("Only assigned balloon volunteers or contest staff can complete delivery.");
  }

  await prisma.balloon.updateMany({
    where: {
      id: balloonId,
      contestId,
      ...(isMaster ? {} : { assignedToId: user?.userId }),
    },
    data: { status: "COMPLETED" },
  });
  revalidatePath(`/contest/${contestId}/balloon`);
}
