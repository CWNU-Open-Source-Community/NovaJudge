import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ContestConfig } from "@/app/(main)/page";
import {
  toISO8601,
  formatDurationFromMinutes,
  toCCSVerdict,
  getRelativeTime,
} from "./utils";
import { getOrganizationDirectory } from "@/lib/org-mapper";
import { matchOrganization, type OrganizationMap } from "@/lib/organizations";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";

export async function getContest(id: number) {
  const contest = await prisma.contest.findUnique({
    where: { id },
  });

  if (!contest) return null;

  const startTime = contest.startTime;
  const endTime = contest.endTime;
  const durationMs = endTime.getTime() - startTime.getTime();

  // Format duration as H:MM:SS.mmm
  const seconds = Math.floor(durationMs / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const duration = `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.000`;

  const config = (contest.config as unknown as ContestConfig) || {};
  const freezeDuration = formatDurationFromMinutes(config.frozenDuration || 0);
  const penalty = 20;

  return {
    id: contest.id.toString(),
    name: contest.title,
    formal_name: contest.title,
    start_time: toISO8601(startTime),
    end_time: toISO8601(endTime),
    duration: duration,
    scoreboard_freeze_duration: freezeDuration,
    penalty_time: penalty,
  };
}

export async function getContestState(id: number) {
  const contest = await prisma.contest.findUnique({
    where: { id },
  });

  if (!contest) return null;

  const startTime = contest.startTime;
  const endTime = contest.endTime;
  const config = (contest.config as unknown as ContestConfig) || {};

  const frozenDuration = config.frozenDuration || 0; // minutes
  const unfreezeDelay = config.unfreezeDelay || 300; // hours

  let frozenTime = null;
  let thawedTime = null;

  if (frozenDuration > 0) {
    frozenTime = new Date(endTime.getTime() - frozenDuration * 60 * 1000);
    thawedTime = new Date(endTime.getTime() + unfreezeDelay * 60 * 60 * 1000);
  }

  const now = new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = {
    started: now >= startTime ? toISO8601(startTime) : null,
    ended: now >= endTime ? toISO8601(endTime) : null,
    finalized: null,
    end_of_updates: null,
  };

  if (frozenTime && now >= frozenTime) {
    state.frozen = toISO8601(frozenTime);
  }

  if (thawedTime && now >= thawedTime) {
    state.thawed = toISO8601(thawedTime);
  }

  return state;
}

export async function getTeams(contestId: number, directory?: OrganizationMap) {
  const [organizations, teams] = await Promise.all([directory ?? getOrganizationDirectory(), prisma.user.findMany({
    where: {
      contestId,
      role: "TEAM",
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      category: true,
      school: true,
    },
  })]);

  return teams.map((team) => {
    const affiliation = matchOrganization(organizations, team.school);
    return {
      id: team.username,
      label: team.username,
      name: String(team.category === "1" ? "⭐" : "") + team.displayName || team.username,
      group_ids: team.category ? [team.category] : [],
      organization_id: affiliation?.id || affiliation?.name || team.school?.trim() || null,
    };
  });
}

export async function getOrganizations(contestId: number, directory?: OrganizationMap) {
  const [organizations, schools] = await Promise.all([directory ?? getOrganizationDirectory(), prisma.user.groupBy({
    by: ["school"],
    where: {
      contestId,
      role: "TEAM",
      school: { not: null },
    },
  })]);
  const result = new Map<string, { id: string; name: string; formal_name: string; country: string | null }>();
  for (const { school } of schools) {
    if (!school?.trim()) continue;
    const affiliation = matchOrganization(organizations, school);
    const name = affiliation?.name || school.trim();
    const id = affiliation?.id || name;
    result.set(id, { id, name, formal_name: name, country: affiliation?.country || null });
  }
  return [...result.values()];
}

export async function getGroups(contestId: number) {
  const groups = await prisma.user.groupBy({
    by: ["category"],
    where: {
      contestId,
      role: "TEAM",
      category: { not: null },
    },
  });

  const CATEGORY_MAP: Record<string, string> = {
    "0": "正式队伍",
    "1": "打星队伍",
    "2": "女生队伍",
  };

  return groups.map((g) => ({
    id: g.category!,
    name: CATEGORY_MAP[g.category!] || g.category!,
  }));
}

export async function getProblems(contestId: number) {
  const problems = await prisma.contestProblem.findMany({
    where: {
      contestId,
    },
    include: {
      problem: true,
    },
    orderBy: {
      displayId: "asc",
    },
  });

  return problems.map((cp, index) => {
    // Parse test_data_count from problem.judgeConfig (if available) or samples
    let testDataCount = 0;

    // Attempt 1: Try to read from judgeConfig (YAML parsed into JSON)
    // The structure might vary, but let's assume standard 'testcases' or similar
    if (cp.problem.judgeConfig) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = cp.problem.judgeConfig as any;
      if (Array.isArray(config.cases)) {
        testDataCount = config.cases.length;
      }
    }

    if (testDataCount === 0) {
      testDataCount = 100;
    }

    return {
      id: cp.problemId.toString(),
      label: cp.displayId,
      name: cp.problem.title,
      ordinal: index,
      time_limit: (cp.realTimeLimit || cp.problem.defaultTimeLimit) / 1000,
      test_data_count: testDataCount,
      rgb: cp.color || null,
    };
  });
}

export async function getLanguages(contestId: number) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { startTime: true, endTime: true },
  });
  if (!contest) return [];

  const languages = await prisma.submission.groupBy({
    by: ["language"],
    where: getOfficialSubmissionWhere({
      contestId,
      startTime: contest.startTime,
      endTime: contest.endTime,
    }),
  });

  if (languages.length === 0) {
    return [
      { id: "c", name: "C" },
      { id: "cpp", name: "C++" },
      { id: "java", name: "Java" },
      { id: "python", name: "Python" },
    ];
  }

  return languages.map((l) => ({
    id: l.language,
    name: l.language,
    entry_point_required: false,
    entry_point_name: null,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatSubmission(sub: any, contestStartTime: Date) {
  return {
    id: sub.id,
    team_id: sub.user?.username || sub.userId,
    problem_id: sub.problemId.toString(),
    language_id: sub.language,
    time: toISO8601(sub.submittedAt),
    contest_time: getRelativeTime(contestStartTime, sub.submittedAt),
    files: [],
  };
}

export function formatJudgement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sub: any,
  contestStartTime: Date,
  overrideVerdict?: string | null,
  overrideEndTime?: Date,
) {
  const verdict =
    overrideVerdict !== undefined ? overrideVerdict : toCCSVerdict(sub.verdict);

  const startTime = sub.submittedAt;
  let endTime = null;
  let judgementTypeId = null;

  if (verdict && sub.verdict !== "PENDING" && sub.verdict !== "JUDGING") {
    // Finished judging
    if (overrideEndTime) {
      endTime = overrideEndTime;
    } else {
      endTime = sub.timeUsed
        ? new Date(startTime.getTime() + sub.timeUsed)
        : startTime;
    }
    judgementTypeId = verdict;
  } else {
    // Currently judging or pending
    endTime = null;
    judgementTypeId = null;
  }

  return {
    id: sub.id,
    submission_id: sub.id,
    judgement_type_id: judgementTypeId,
    start_time: toISO8601(startTime),
    end_time: endTime ? toISO8601(endTime) : null,
    start_contest_time: getRelativeTime(contestStartTime, startTime),
    end_contest_time: endTime
      ? getRelativeTime(contestStartTime, endTime)
      : null,
  };
}

export function formatRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sub: any,
  ordinal: number,
  contestStartTime: Date,
  verdict: string = "AC",
  runTime?: Date,
) {
  const time = runTime || sub.submittedAt;
  return {
    id: `${sub.id}-${ordinal}`,
    judgement_id: sub.id,
    ordinal: ordinal,
    judgement_type_id: verdict,
    time: toISO8601(time),
    contest_time: getRelativeTime(contestStartTime, time),
    team_id: sub.user?.username || sub.userId,
    problem_id: sub.problemId.toString(),
    language_id: sub.language,
  };
}

export async function getSubmissions(contestId: number) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return [];

  const submissions = await prisma.submission.findMany({
    where: getOfficialSubmissionWhere({
      contestId,
      startTime: contest.startTime,
      endTime: contest.endTime,
    }),
    include: {
      user: true,
      problem: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
  });

  return submissions.map((sub) => formatSubmission(sub, contest.startTime));
}

export async function getJudgements(contestId: number) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return [];

  const submissions = await prisma.submission.findMany({
    where: getOfficialSubmissionWhere({
      contestId,
      startTime: contest.startTime,
      endTime: contest.endTime,
    }),
    include: {
      user: true,
      problem: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
  });

  return submissions
    .map((sub) => {
      if (sub.verdict === "PENDING") return null;
      return formatJudgement(sub, contest.startTime);
    })
    .filter(Boolean);
}

export async function getRuns(contestId: number) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return [];

  const submissions = await prisma.submission.findMany({
    where: {
      ...getOfficialSubmissionWhere({
        contestId,
        startTime: contest.startTime,
        endTime: contest.endTime,
      }),
      verdict: {
        not: "PENDING", // 只返回开始评测的提交
      },
    },
    include: {
      user: true,
      problem: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRuns: any[] = [];

  for (const sub of submissions) {
    const verdict = toCCSVerdict(sub.verdict);

    // ==========================================
    // 核心修改：如果是 JUDGING 状态，从 Redis 获取实时进度
    // ==========================================
    let passedTests = sub.passedTests || 0;
    if (sub.verdict === "JUDGING") {
      const redisKey = `submission:${sub.id}:progress`;
      const redisData = await redis.get(redisKey);
      if (redisData) {
        try {
          const progress = JSON.parse(redisData as string);
          if (progress && typeof progress.passedTests === "number") {
            // 取 DB 和 Redis 的最大值，防止数据回退
            passedTests = Math.max(passedTests, progress.passedTests);
          }
        } catch (e) {
          console.log("Redis parse error in getRuns:", e);
        }
      }
    }

    // 为通过的测试点生成 AC 的 Runs
    for (let i = 1; i <= passedTests; i++) {
      allRuns.push(formatRun(sub, i, contest.startTime));
    }

    // 如果判题彻底结束且不是 AC，添加最后一个报错的 Run
    // 必须确保它不是 JUDGING 状态！
    if (verdict && verdict !== "AC" && sub.verdict !== "JUDGING") {
      const failOrdinal = passedTests + 1;
      allRuns.push(formatRun(sub, failOrdinal, contest.startTime, verdict));
    }
  }

  return allRuns;
}

export async function getSubmissionStates(contestId: number) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { startTime: true, endTime: true },
  });
  if (!contest) return [];

  return await prisma.submission.findMany({
    where: getOfficialSubmissionWhere({
      contestId,
      startTime: contest.startTime,
      endTime: contest.endTime,
    }),
    select: {
      id: true,
      verdict: true,
      passedTests: true,
      submittedAt: true,
      userId: true,
      user: {
        select: {
          username: true,
        },
      },
      problemId: true,
      language: true,
      timeUsed: true,
    },
    orderBy: { submittedAt: "asc" },
  });
}
