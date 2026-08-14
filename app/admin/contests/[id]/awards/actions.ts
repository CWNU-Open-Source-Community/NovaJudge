"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentSuper } from "@/lib/auth";
import { ContestStatus } from "@/lib/generated/prisma/enums";
import {
  computeContestStandings,
  getContestAwardsConfig,
  getContestMedalConfig,
  getFirstSolves,
  type ContestAwardsConfig,
  type FirstSolveInfo,
  type StandingRow,
} from "@/lib/awards";
import type { ContestMedalConfig } from "@/lib/medal-utils";

// 保存时提交的奖项数据
export interface AwardsInput {
  medal: {
    mode: "ratio" | "fixed";
    gold: number;
    silver: number;
    bronze: number;
  };
  awards: {
    enabled: boolean;
    base: { gold?: string; silver?: string; bronze?: string };
    firstToSolve?: boolean;
    excellenceAward?: boolean;
    excellenceCitation?: string;
    topThree?: boolean;
    topThreeCitations?: {
      champion?: string;
      runnerUp?: string;
      third?: string;
    };
    custom: { citation: string; teamIds: string[] }[];
  };
}

async function requireAdmin() {
  const admin = await getCurrentSuper();
  if (!admin || !admin.isGlobalAdmin) {
    throw new Error("Unauthorized");
  }
}

export interface AwardsPageData {
  error?: string;
  contest?: {
    id: number;
    title: string;
    status: ContestStatus;
    startTime: Date;
    endTime: Date;
  };
  standings?: StandingRow[];
  medal?: ContestMedalConfig;
  awards?: ContestAwardsConfig;
  problems?: { problemId: number; displayId: string }[];
  firstSolves?: FirstSolveInfo[];
}

// 奖项设置页数据：比赛信息 + 最终榜单 + 当前配置
export async function getAwardsPageData(
  contestId: number,
): Promise<AwardsPageData> {
  try {
    await requireAdmin();

    const contest = await prisma.contest.findUnique({
      where: { id: contestId },
      select: {
        id: true,
        title: true,
        status: true,
        startTime: true,
        endTime: true,
      },
    });
    if (!contest) return { error: "Contest not found" };

    const [standings, medal, awards, problems, firstSolves] =
      await Promise.all([
        computeContestStandings(contestId),
        getContestMedalConfig(contestId),
        getContestAwardsConfig(contestId),
        prisma.contestProblem.findMany({
          where: { contestId },
          select: { problemId: true, displayId: true },
          orderBy: { displayId: "asc" },
        }),
        getFirstSolves(contestId),
      ]);

    return { contest, standings, medal, awards, problems, firstSolves };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: (e as any).message || "Failed to load awards data" };
  }
}

// 保存奖项设置到 contest.config（merge，不影响其他配置）
export async function saveContestAwards(
  contestId: number,
  input: AwardsInput,
): Promise<{ success?: boolean; error?: string }> {
  try {
    await requireAdmin();

    const contest = await prisma.contest.findUnique({
      where: { id: contestId },
      select: { config: true },
    });
    if (!contest) return { error: "Contest not found" };

    // 1. 基础校验
    const medal = {
      mode: input.medal.mode === "fixed" ? ("fixed" as const) : ("ratio" as const),
      gold: Math.max(0, Math.floor(Number(input.medal.gold) || 0)),
      silver: Math.max(0, Math.floor(Number(input.medal.silver) || 0)),
      bronze: Math.max(0, Math.floor(Number(input.medal.bronze) || 0)),
    };
    if (medal.mode === "ratio") {
      if (medal.gold > 100 || medal.silver > 100 || medal.bronze > 100) {
        return { error: "Ratio percentages must be between 0 and 100." };
      }
    }

    // 2. 自定义奖项校验
    const custom = (Array.isArray(input.awards.custom)
      ? input.awards.custom
      : []
    )
      .map((a) => ({
        citation: (a.citation || "").trim(),
        teamIds: Array.from(
          new Set(Array.isArray(a.teamIds) ? a.teamIds : []),
        ),
      }))
      .filter((a) => a.citation || a.teamIds.length > 0);

    const allTeamIds = custom.flatMap((a) => a.teamIds);
    if (allTeamIds.length > 0) {
      const existing = await prisma.user.findMany({
        where: {
          contestId,
          role: "TEAM",
          username: { in: allTeamIds },
        },
        select: { username: true },
      });
      const valid = new Set(existing.map((u) => u.username));
      const missing = allTeamIds.filter((name) => !valid.has(name));
      if (missing.length > 0) {
        return {
          error: `Unknown team usernames: ${missing.slice(0, 5).join(", ")}`,
        };
      }
    }
    for (const a of custom) {
      if (!a.citation) {
        return { error: "Every custom award needs a citation (name)." };
      }
    }
    const customWithIds = custom.map((a, index) => ({
      id: `special-${index + 1}`,
      citation: a.citation,
      teamIds: a.teamIds,
    }));

    // 3. 合并进 contest.config（保留其他字段）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = (contest.config as any) || {};
    const next = {
      ...prev,
      medal,
      awards: {
        enabled: Boolean(input.awards.enabled),
        base: {
          gold: (input.awards.base?.gold || "").trim() || undefined,
          silver: (input.awards.base?.silver || "").trim() || undefined,
          bronze: (input.awards.base?.bronze || "").trim() || undefined,
        },
        firstToSolve: Boolean(input.awards.firstToSolve),
        excellenceAward: Boolean(input.awards.excellenceAward),
        excellenceCitation:
          (input.awards.excellenceCitation || "").trim() || undefined,
        topThree: Boolean(input.awards.topThree),
        topThreeCitations: {
          champion:
            (input.awards.topThreeCitations?.champion || "").trim() ||
            undefined,
          runnerUp:
            (input.awards.topThreeCitations?.runnerUp || "").trim() ||
            undefined,
          third:
            (input.awards.topThreeCitations?.third || "").trim() || undefined,
        },
        custom: customWithIds,
      },
    };

    await prisma.contest.update({
      where: { id: contestId },
      data: { config: next },
    });

    revalidatePath(`/admin/contests/${contestId}/awards`);
    revalidatePath(`/admin/contests/${contestId}/edit`);
    return { success: true };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: (e as any).message || "Failed to save awards" };
  }
}
