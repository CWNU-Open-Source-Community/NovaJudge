import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getJwtSecretKey, signAuth } from "@/lib/auth";
import { matchesContestPassword, signContestAccessToken } from "@/lib/contest-access-token";
import { ContestStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrimaryClientIp } from "@/lib/request-ip";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const contestPassword = String(body?.contestPassword || "");
    const rawContestId = body?.contestId;

    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 },
      );
    }

    let contestId =
      rawContestId === undefined || rawContestId === null
        ? null
        : Number(rawContestId);
    if (contestId !== null && !Number.isInteger(contestId)) {
      return NextResponse.json(
        { error: "contestId must be an integer" },
        { status: 400 },
      );
    }

    if (contestId === null) {
      const candidates = await prisma.user.findMany({
        where: {
          username,
          contest: { status: ContestStatus.RUNNING },
        },
        select: { contestId: true },
      });

      if (candidates.length !== 1) {
        return NextResponse.json(
          {
            error:
              candidates.length === 0
                ? "No running contest found for this username; pass --contest"
                : "Multiple running contests found; pass --contest",
          },
          { status: 400 },
        );
      }

      contestId = candidates[0].contestId;
    }

    const user = await prisma.user.findUnique({
      where: {
        contestId_username: {
          contestId,
          username,
        },
      },
      include: {
        contest: { select: { id: true, title: true, status: true, type: true, password: true } },
      },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json(
        { error: "invalid username or password" },
        { status: 401 },
      );
    }

    let contestAccessToken: string | null = null;
    if (user.contest.type === "PRIVATE") {
      if (!matchesContestPassword(contestPassword, user.contest.password)) {
        return NextResponse.json({
          error: "请提供正确的比赛密码（contestPassword）",
          code: "CONTEST_PASSWORD_REQUIRED",
        }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
      }
      contestAccessToken = await signContestAccessToken(user.contest, getJwtSecretKey());
    }

    const ip = getPrimaryClientIp(req.headers) || "unknown";
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      },
    });

    const token = await signAuth({
      userId: user.id,
      username: user.username,
      role: user.role,
      contestId: user.contestId,
      isGlobalAdmin: false,
    });

    return NextResponse.json({
      token,
      contestAccessToken,
      user: {
        username: user.username,
        role: user.role,
        contestId: user.contestId,
        displayName: user.displayName,
      },
      contest: { id: user.contest.id, title: user.contest.title, status: user.contest.status },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("CLI login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
