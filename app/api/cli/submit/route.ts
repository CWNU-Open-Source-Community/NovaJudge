import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { createContestSubmission } from "@/lib/contest-submission";
import { prisma } from "@/lib/prisma";
import { cliContestAccessResponse } from "../contest-access";
import { assertCliEnabled } from "@/lib/cli-deployment";
import { assertActiveCliContest, CliDeviceError, cliErrorResponse } from "@/lib/cli-devices";
import { lockCliSettings } from "@/lib/cli-settings-lock";

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
    const language = String(body?.language || "").trim();
    const code = String(body?.code || "");

    if (!Number.isInteger(contestId) || contestId !== payload.contestId) {
      return NextResponse.json(
        { error: "contestId does not match current token" },
        { status: 403 },
      );
    }

    if (!problemDisplayId || !language || !code) {
      return NextResponse.json(
        { error: "problem, language and code are required" },
        { status: 400 },
      );
    }

    await assertActiveCliContest(contestId);
    const denied = await cliContestAccessResponse(req, contestId);
    if (denied) return denied;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, contestId: true, role: true },
    });

    if (!user || user.contestId !== contestId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const submission = await createContestSubmission({
      contestId,
      contestAccessToken: req.headers.get("x-contest-access-token") || undefined,
      problemDisplayId,
      language,
      code,
      actor: {
        type: "contest",
        userId: user.id,
        role: user.role,
        isGlobalAdmin: false,
      },
      persistSubmission: (data) => prisma.$transaction(async (tx) => {
        await lockCliSettings(tx, "shared");
        await assertActiveCliContest(contestId, tx);
        return tx.submission.create({ data });
      }),
    });

    return NextResponse.json({
      success: true,
      submission,
      statusUrl: `/contest/${contestId}/status/${submission.displayId}`,
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
