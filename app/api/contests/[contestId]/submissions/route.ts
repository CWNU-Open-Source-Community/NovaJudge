import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Verdict } from "@/lib/generated/prisma/client";
import { validateApiKey } from "@/lib/auth";
import { contestAccessResponse } from "@/lib/contest-access";

const verdictToHydroStatus: Record<Verdict, string> = {
  [Verdict.PENDING]: "Waiting",
  [Verdict.JUDGING]: "Running",
  [Verdict.ACCEPTED]: "Accepted",
  [Verdict.WRONG_ANSWER]: "Wrong Answer",
  [Verdict.TIME_LIMIT_EXCEEDED]: "Time Exceeded",
  [Verdict.MEMORY_LIMIT_EXCEEDED]: "Memory Exceeded",
  [Verdict.RUNTIME_ERROR]: "Runtime Error",
  [Verdict.COMPILE_ERROR]: "Compile Error",
  [Verdict.PRESENTATION_ERROR]: "Format Error",
  [Verdict.SYSTEM_ERROR]: "System Error",
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}:${milliseconds}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  try {
    const apiKey = request.headers.get("x-api-key");
    let isGlobalAdmin = false;
    if (apiKey) {
      const user = await validateApiKey(apiKey);
      if (!user) {
        return NextResponse.json({ error: "Invalid API Key" }, { status: 403 });
      }
      isGlobalAdmin = user.role === "SUPER_ADMIN";
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { contestId } = await params;
    const contestIdNumber = Number(contestId);

    if (isNaN(contestIdNumber)) {
      return NextResponse.json({ error: "Invalid contestId" }, { status: 400 });
    }

    const denied = await contestAccessResponse(contestIdNumber);
    if (denied && (denied.status !== 403 || !isGlobalAdmin)) return denied;

    const submissions = await prisma.submission.findMany({
      where: {
        contestId: contestIdNumber,
      },
      include: {
        user: true,
        problem: true,
        globalUser: true,
      },
      orderBy: {
        submittedAt: "desc",
      },
    });

    const result = submissions.map((sub) => {
      let score = 0;
      if (sub.verdict === Verdict.ACCEPTED) {
        score = 100;
      }

      const status = verdictToHydroStatus[sub.verdict] || "Unknown Error";
      const runtime = sub.timeUsed || 0;
      const memory = sub.memoryUsed || 0;

      return {
        rid: sub.id,
        status: status,
        score: score,
        problem: sub.problem?.title || "",
        username: sub.user?.username || sub.globalUser?.username || "",
        runtime: runtime,
        memory: memory,
        language: sub.language,
        submit_time: formatDate(sub.submittedAt),
        code: sub.code,
      };
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Get submissions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
