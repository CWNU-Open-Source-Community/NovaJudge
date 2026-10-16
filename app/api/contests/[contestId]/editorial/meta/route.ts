import { getCurrentSuper } from "@/lib/auth";
import { ContestStatus } from "@/lib/generated/prisma/client";
import { contestAccessResponse } from "@/lib/contest-access";
import { prisma } from "@/lib/prisma";
import { getRunningVirtualParticipation } from "@/lib/virtual-participation";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import path from "node:path";

type ContestConfig = {
  editorialPdf?: {
    filename: string;
    uploadedAt: string;
  };
};

function getEditorialPdfPath(contestId: number) {
  return path.join(
    process.cwd(),
    "uploads",
    "contests",
    contestId.toString(),
    "editorial.pdf",
  );
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const { contestId } = await params;
  const id = Number(contestId);

  if (!Number.isInteger(id)) {
    return NextResponse.json({ available: false }, { status: 400 });
  }

  const denied = await contestAccessResponse(id);
  if (denied) return denied;

  const contest = await prisma.contest.findUnique({
    where: { id },
    select: {
      id: true,
      config: true,
      status: true,
      type: true,
    },
  });

  if (!contest) {
    return NextResponse.json({ available: false }, { status: 404 });
  }

  const superUser = await getCurrentSuper();
  const isGlobalAdmin = !!superUser?.isGlobalAdmin;
  const runningVp =
    superUser?.userId && !isGlobalAdmin
      ? await getRunningVirtualParticipation(id, String(superUser.userId))
      : null;

  if (runningVp) {
    return NextResponse.json({ available: false });
  }

  const config = (contest.config as ContestConfig | null) || {};
  const available =
    contest.status === ContestStatus.ENDED &&
    !!config.editorialPdf &&
    (await fileExists(getEditorialPdfPath(id)));

  return NextResponse.json({
    available,
    filename: available ? config.editorialPdf?.filename : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
