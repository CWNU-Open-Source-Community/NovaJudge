import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/auth";
import { contestAccessResponse } from "@/lib/contest-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  try {
    const { contestId } = await params;
    const contestIdNumber = Number(contestId);

    if (isNaN(contestIdNumber)) {
      return NextResponse.json({ error: "Invalid contestId" }, { status: 400 });
    }

    const denied = await contestAccessResponse(contestIdNumber);
    if (denied) {
      // Preserve server integrations only for verified global administrators.
      const apiKey = request.headers.get("x-api-key");
      const apiUser = apiKey ? await validateApiKey(apiKey) : null;
      if (denied.status !== 403 || apiUser?.role !== "SUPER_ADMIN") return denied;
    }

    const contestProblems = await prisma.contestProblem.findMany({
      where: {
        contestId: contestIdNumber,
      },
      include: {
        problem: true,
      },
      orderBy: {
        displayId: "asc",
      },
    });

    const result = contestProblems.map((cp) => {
      // 优先使用 ContestProblem 中的限制，如果没有则使用 Problem 中的默认限制
      const timeLimit = cp.realTimeLimit ?? cp.problem.defaultTimeLimit;
      const memoryLimit = cp.realMemoryLimit ?? cp.problem.defaultMemoryLimit;

      return {
        displayId: cp.displayId,
        name: cp.problem.title,
        time: timeLimit,
        memory: memoryLimit,
        score: 100, // 默认分数
      };
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Get problems error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
