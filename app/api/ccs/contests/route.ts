import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCCSAuth, unauthorizedResponse } from "@/lib/ccs/auth";
import { toISO8601, formatDurationFromMinutes } from "@/lib/ccs/utils";
import { ContestConfig } from "@/app/(main)/page";

export async function GET(req: NextRequest) {
  const isAuthorized = await checkCCSAuth(req);
  if (!isAuthorized) {
    return unauthorizedResponse();
  }

  const contests = await prisma.contest.findMany({
    orderBy: { startTime: "desc" },
  });

  const result = contests.map((contest) => {
    const durationMs = contest.endTime.getTime() - contest.startTime.getTime();
    const seconds = Math.floor(durationMs / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const duration = `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.000`;

    const config = (contest.config as unknown as ContestConfig) || {};
    const freezeDuration = formatDurationFromMinutes(config.frozenDuration);
    const penalty = 20;

    return {
      id: contest.id.toString(),
      name: contest.title,
      formal_name: contest.title,
      start_time: toISO8601(contest.startTime),
      end_time: toISO8601(contest.endTime),
      duration: duration,
      scoreboard_freeze_duration: freezeDuration,
      penalty_time: penalty,
      state: {
        // Optional state info
      },
    };
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
