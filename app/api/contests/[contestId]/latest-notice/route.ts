import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ClariCategory } from "@/lib/generated/prisma/enums";
import { contestAccessResponse } from "@/lib/contest-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const contestId = Number((await params).contestId);
  const denied = await contestAccessResponse(contestId);
  if (denied) return denied;

  try {
    const latestNotice = await prisma.clarification.findFirst({
      where: {
        contestId,
        category: ClariCategory.NOTICE,
        isPublic: true,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    });

    return NextResponse.json({ success: true, data: latestNotice }, {
      headers: { "Cache-Control": "private, no-store" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.log(error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
