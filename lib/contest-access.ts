import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentSuper, getJwtSecretKey } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  contestAccessCookieName,
  verifyContestAccessToken,
} from "@/lib/contest-access-token";

// React cache is scoped to a server render, never shared across visitors.
export const getContestAccess = cache(async (contestId: number) => {
  if (!Number.isSafeInteger(contestId) || contestId <= 0) {
    return { contest: null, allowed: false };
  }
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, type: true, password: true },
  });
  if (!contest) return { contest: null, allowed: false };
  if (contest.type === "PUBLIC") return { contest, allowed: true };

  const admin = await getCurrentSuper();
  if (admin?.isGlobalAdmin) return { contest, allowed: true };

  const token = (await cookies()).get(contestAccessCookieName(contestId))?.value;
  const allowed = !!token && await verifyContestAccessToken(token, contest, getJwtSecretKey());
  return { contest, allowed };
});

export async function hasContestAccess(contestId: number) {
  return (await getContestAccess(contestId)).allowed;
}

export async function requireContestAccess(contestId: number) {
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) notFound();
  if (!allowed) redirect(`/contest/${contestId}/access`);
}

export async function contestAccessResponse(contestId: number) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!Number.isSafeInteger(contestId) || contestId <= 0) {
    return NextResponse.json({ error: "Invalid contestId" }, { status: 400, headers });
  }
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404, headers });
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "请先输入比赛密码", code: "CONTEST_PASSWORD_REQUIRED" },
      { status: 403, headers },
    );
  }
  return null;
}
