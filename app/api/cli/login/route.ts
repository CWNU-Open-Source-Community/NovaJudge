import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getJwtSecretKey, signAuth, validateApiKey } from "@/lib/auth";
import { randomBytes } from "node:crypto";
import { proctoringKeyHash, PROCTORING_REQUIRED } from "@/lib/proctoring-access";
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
    const proctored = body?.loginSource === "PROCTORING";
    if (body?.loginSource !== undefined && !proctored) {
      return NextResponse.json({ error: "invalid loginSource" }, { status: 400 });
    }

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
    let proctoringKey: string | undefined;
    let keyHash: string | undefined;
    if (proctored) {
      const administrator = await validateApiKey(req.headers.get("x-api-key") || "");
      if (user.role !== "TEAM" || administrator?.role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Proctoring login requires an enabled administrator API key and a team account" }, { status: 403 });
      }
      proctoringKey = randomBytes(32).toString("base64url");
      keyHash = proctoringKeyHash(proctoringKey);
    } else if (user.proctoringKeyHash) {
      return NextResponse.json({ error: PROCTORING_REQUIRED, code: "PROCTORING_CLIENT_REQUIRED" }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginIp: ip,
        lastLoginAt: new Date(),
        ...(keyHash ? { proctoringKeyHash: keyHash, proctoringLoginAt: new Date() } : {}),
      },
    });

    const token = await signAuth({
      userId: user.id,
      username: user.username,
      role: user.role,
      contestId: user.contestId,
      isGlobalAdmin: false,
      ...(keyHash ? { loginSource: "PROCTORING" as const, proctoringKeyHash: keyHash } : {}),
    });

    return NextResponse.json({
      token,
      ...(proctoringKey ? { loginSource: "PROCTORING", proctoringKey } : {}),
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
