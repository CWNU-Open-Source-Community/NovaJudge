import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cliContestAccessResponse } from "../contest-access";
import { assertCliEnabled } from "@/lib/cli-deployment";
import { assertActiveCliContest, CliDeviceError, cliErrorResponse } from "@/lib/cli-devices";

export async function POST(req: Request) {
  try {
    assertCliEnabled();
    const auth = req.headers.get("authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { error: "Missing Bearer token" },
        { status: 401 },
      );
    }

    const payload = await verifyAuth(match[1]);
    if (!payload?.userId || !payload.contestId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (payload.role !== ContestRole.TEAM) {
      return NextResponse.json(
        { error: "Only team accounts can submit from CLI" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const contestId = Number(body?.contestId || payload.contestId);
    const problemDisplayId = String(body?.problem || "").trim().toUpperCase();

    if (!Number.isInteger(contestId) || contestId !== payload.contestId) {
      return NextResponse.json(
        { error: "contestId does not match current token" },
        { status: 403 },
      );
    }

    if (!problemDisplayId) {
      return NextResponse.json(
        { error: "problem is required" },
        { status: 400 },
      );
    }

    await assertActiveCliContest(contestId);
    const denied = await cliContestAccessResponse(req, contestId);
    if (denied) return denied;

    const [user, contestProblem] = await Promise.all([
      prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          username: true,
          displayName: true,
          contestId: true,
        },
      }),
      prisma.contestProblem.findFirst({
        where: {
          contestId,
          displayId: problemDisplayId,
        },
        select: {
          displayId: true,
          problem: { select: { title: true } },
          contest: { select: { title: true } },
        },
      }),
    ]);

    if (!user || user.contestId !== contestId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    if (!contestProblem) {
      return NextResponse.json(
        { error: "Problem not found in this contest" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      contestName: contestProblem.contest.title,
      teamName: user.displayName || user.username,
      problemName: `${contestProblem.displayId} - ${contestProblem.problem.title}`,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CliDeviceError) return cliErrorResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("expired") || message.includes("invalid") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
