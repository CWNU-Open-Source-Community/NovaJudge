import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSuper, UserJwtPayload } from "@/lib/auth";

// 轻量题目列表（id + title），供管理后台下拉选择使用
export async function GET() {
  const admin = await getCurrentSuper();
  if (!admin || !(admin as UserJwtPayload).isGlobalAdmin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const problems = await prisma.problem.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      title: true,
    },
    take: 2000,
  });

  return NextResponse.json(problems);
}
