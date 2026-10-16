import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contestAccessResponse } from "@/lib/contest-access";

interface Props {
  params: Promise<{ contestId: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { contestId } = await params;
  const cid = Number(contestId);
  if (!Number.isInteger(cid)) {
    return NextResponse.json({ error: "Invalid contest id." }, { status: 400 });
  }

  const denied = await contestAccessResponse(cid);
  if (denied) return denied;

  const token = (await cookies()).get("user_token")?.value;
  if (!token) {
    return NextResponse.json({ jobs: [] }, { status: 401 });
  }

  try {
    const payload = await verifyAuth(token);
    if (payload.contestId !== cid || payload.role !== ContestRole.TEAM) {
      return NextResponse.json({ jobs: [] }, { status: 403 });
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

    return NextResponse.json({ jobs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ jobs: [] }, { status: 401 });
  }
}
