import { NextRequest, NextResponse } from "next/server";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import { prisma } from "@/lib/prisma";
import { Verdict } from "@/lib/generated/prisma/client";

function escapeDatString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function verdictToGymDatStatus(verdict: Verdict) {
  switch (verdict) {
    case "ACCEPTED":
      return "OK";
    case "WRONG_ANSWER":
      return "WA";
    case "TIME_LIMIT_EXCEEDED":
      return "TL";
    case "MEMORY_LIMIT_EXCEEDED":
      return "ML";
    case "RUNTIME_ERROR":
      return "RT";
    case "COMPILE_ERROR":
      return "CE";
    case "PRESENTATION_ERROR":
      return "PE";
    case "PENDING":
    case "JUDGING":
      return "PD";
    case "SYSTEM_ERROR":
    default:
      return "RJ";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const isAuthorized = await checkCCSAuth(request);
  if (!isAuthorized) {
    return unauthorizedResponse();
  }

  const { contestId } = await params;
  const cid = parseInt(contestId);

  if (isNaN(cid)) {
    return new NextResponse("Invalid contest ID", { status: 400 });
  }

  const contest = await prisma.contest.findUnique({
    where: { id: cid },
    include: {
      problems: {
        include: {
          problem: true,
        },
        orderBy: {
          displayId: "asc",
        },
      },
      users: {
        where: {
          role: "TEAM",
        },
        orderBy: {
          username: "asc",
        },
      },
      submissions: {
        orderBy: {
          submittedAt: "asc",
        },
        include: {
          user: true,
        },
      },
    },
  });

  if (!contest) {
    return new NextResponse("Contest not found", { status: 404 });
  }

  const problemLabelMap = new Map<number, string>();
  contest.problems.forEach((cp) => {
    problemLabelMap.set(cp.problemId, cp.displayId);
  });

  const teamIdMap = new Map<string, number>();
  const submissionsIdMap = new Map<string, Map<number, number>>();

  contest.users.forEach((team, index) => {
    teamIdMap.set(team.id, index + 1);

    const attempts = new Map<number, number>();
    contest.problems.forEach((cp) => {
      attempts.set(cp.problemId, 0);
    });
    submissionsIdMap.set(team.id, attempts);
  });

  const exportableSubmissions = contest.submissions.filter(
    (submission) =>
      submission.userId &&
      submission.user?.role === "TEAM" &&
      teamIdMap.has(submission.userId) &&
      problemLabelMap.has(submission.problemId),
  );

  let output = "";

  output += `@contest "${escapeDatString(contest.title)}"\n`;

  const durationMinutes = Math.floor(
    (contest.endTime.getTime() - contest.startTime.getTime()) / 60000,
  );
  output += `@contlen ${durationMinutes}\n`;
  output += `@problems ${contest.problems.length}\n`;
  output += `@teams ${contest.users.length}\n`;
  output += `@submissions ${exportableSubmissions.length}\n`;

  contest.problems.forEach((cp) => {
    output += `@p ${cp.displayId},${cp.displayId},20,0\n`;
  });

  contest.users.forEach((team, index) => {
    const nameParts = [];
    if (team.school) {
      nameParts.push(team.school);
    }

    nameParts.push(team.displayName || team.username);

    if (team.members) {
      nameParts.push(team.members);
    }

    output += `@t ${index + 1},0,1,"${escapeDatString(nameParts.join(" - "))}"\n`;
  });

  for (const sub of exportableSubmissions) {
    const teamIndex = teamIdMap.get(sub.userId!);
    const letter = problemLabelMap.get(sub.problemId);
    const attempts = submissionsIdMap.get(sub.userId!);

    if (!teamIndex) continue;
    if (!letter) continue;
    if (!attempts) continue;

    const attempt = (attempts.get(sub.problemId) ?? 0) + 1;
    attempts.set(sub.problemId, attempt);

    let time = Math.floor(
      (sub.submittedAt.getTime() - contest.startTime.getTime()) / 1000,
    );
    if (time < 0) time = 0;

    output += `@s ${teamIndex},${letter},${attempt},${time},${verdictToGymDatStatus(sub.verdict)}\n`;
  }

  return new NextResponse(output, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="contest-${cid}-ghost.dat"`,
    },
  });
}
