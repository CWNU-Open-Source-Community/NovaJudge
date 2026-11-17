import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contestAccessResponse } from "@/lib/contest-access";
import { proctoringAccessAllowed, PROCTORING_HEADER, PROCTORING_REQUIRED } from "@/lib/proctoring-access";

interface Props {
  params: Promise<{ contestId: string }>;
}

export async function GET(request: Request, { params }: Props) {
  const { contestId } = await params;
  const cid = Number(contestId);
  if (!Number.isInteger(cid)) {
    return NextResponse.json({ error: "Invalid contest id." }, { status: 400 });
  }

  const denied = await contestAccessResponse(cid);
  if (denied) return denied;

  const headers = { "Cache-Control": "private, no-store" };
  try {
    // Use the same active identity as the proxy: a valid global login takes
    // precedence over a stale contest cookie, and team roles come from the DB.
    const payload = await getCurrentUser();
    if (!payload) {
      return NextResponse.json({ jobs: [] }, { status: 401, headers });
    }
    if (payload.contestId !== cid || payload.role !== ContestRole.TEAM) {
      return NextResponse.json({ jobs: [] }, { status: 403, headers });
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { proctoringKeyHash: true },
    });
    if (!user) {
      return NextResponse.json({ jobs: [] }, { status: 401, headers });
    }
    if (!proctoringAccessAllowed(user.proctoringKeyHash, payload, request.headers.get(PROCTORING_HEADER))) {
      return NextResponse.json(
        { error: PROCTORING_REQUIRED, code: "PROCTORING_CLIENT_REQUIRED" },
        { status: 403, headers },
      );
    }

    const jobs = await prisma.printJob.findMany({
      where: {
        contestId: cid,
        userId: payload.userId,
      },
      select: {
        id: true,
        language: true,
        sourceFilename: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        printedAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    return NextResponse.json({ jobs }, { headers });
  } catch {
    return NextResponse.json({ jobs: [] }, { status: 401, headers });
  }
}
