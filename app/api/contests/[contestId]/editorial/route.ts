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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const { contestId } = await params;
  const id = Number(contestId);

  if (!Number.isInteger(id)) {
    return new NextResponse("Invalid contest id", { status: 400 });
  }

  const denied = await contestAccessResponse(id);
  if (denied) return denied;

  const contest = await prisma.contest.findUnique({
    where: { id },
    select: {
      config: true,
      status: true,
      type: true,
    },
  });

  if (!contest) {
    return new NextResponse("Contest not found", { status: 404 });
  }

  const superUser = await getCurrentSuper();
  const isGlobalAdmin = !!superUser?.isGlobalAdmin;
  const runningVp =
    superUser?.userId && !isGlobalAdmin
      ? await getRunningVirtualParticipation(id, String(superUser.userId))
      : null;

  if (runningVp) {
    return new NextResponse("Editorial is not available during VP", {
      status: 403,
    });
  }

  const config = (contest.config as ContestConfig | null) || {};

  if (contest.status !== ContestStatus.ENDED || !config.editorialPdf) {
    return new NextResponse("Editorial is not available", { status: 404 });
  }

  try {
    const file = await fs.readFile(getEditorialPdfPath(id));
    return new NextResponse(file, {
      headers: {
        "Content-Disposition": `inline; filename="${config.editorialPdf.filename}"`,
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Editorial PDF not found", { status: 404 });
  }
}
