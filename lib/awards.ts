import { prisma } from "./prisma";
import { Verdict } from "./generated/prisma/enums";
import {
  getMedalCounts,
  formatFtsCitation,
  DEFAULT_MEDAL,
  type ContestMedalConfig,
} from "./medal-utils";

// ================= 奖项模块 =================
// 奖项设置保存在 contest.config.awards 中；导出 Event Feed 时按最终榜单
// 计算金银铜并输出 ICPC Tools resolver 可识别的 awards 事件。

export type { ContestMedalConfig };
export interface CustomAward {
  /** 稳定 id（如 special-1），用于 resolver 区分奖项 */
  id: string;
  /** 奖项名称（citation），滚榜时展示 */
  citation: string;
  /** 获奖队伍的 username 列表（与 event-feed 中 team id 一致） */
  teamIds: string[];
}

export interface ContestAwardsConfig {
  enabled: boolean;
  /** 金银铜奖项名称（citation）覆盖，默认 Gold/Silver/Bronze Medal */
  base?: {
    gold?: string;
    silver?: string;
    bronze?: string;
  };
  /** 快速解题奖：每题第一个 AC 的队伍（含打星队伍），默认关闭。
   *  citation 采用 DOMjudge 原生格式：同一队伍多个一血合并为一个奖，
   *  如 First to solve problem A / First to solve problems A and B /
   *  First to solve problems A, B, C and D */
  firstToSolve?: boolean;
  /** 优秀奖：未获金银铜、但解出至少 1 题的队伍，默认关闭 */
  excellenceAward?: boolean;
  /** 优秀奖名称，默认「优秀奖」 */
  excellenceCitation?: string;
  /** 冠军/亚军/季军（按学校去重：每个学校最多一个席位，取该校最好队伍），默认关闭 */
  topThree?: boolean;
  topThreeCitations?: {
    champion?: string;
    runnerUp?: string;
    third?: string;
  };
  custom: CustomAward[];
}

export interface FirstSolveInfo {
  problemId: number;
  displayId: string;
  username: string;
  submittedAt: Date;
}

export interface StandingRow {
  username: string;
  displayName: string | null;
  school: string | null;
  category: string | null;
  isStar: boolean; // 打星队伍（category === "1"），不参与奖牌
  solved: number;
  penalty: number;
}

export interface FeedAward {
  id: string;
  citation: string;
  team_ids: string[];
  /** 展示模式（与 ICPC Tools 一致）：金银铜会额外生成一条 "list" 副本 */
  display_mode?: string;
}

/** 读取比赛的奖牌配置（config.medal），缺省返回空配置 */
export async function getContestMedalConfig(
  contestId: number,
): Promise<ContestMedalConfig> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { config: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (contest?.config as any) || {};
  const medal = config.medal || DEFAULT_MEDAL;
  return {
    mode: medal.mode || "ratio",
    gold: Number(medal.gold || 0),
    silver: Number(medal.silver || 0),
    bronze: Number(medal.bronze || 0),
  };
}

/** 读取比赛的奖项设置（config.awards），缺省为未启用 */
export async function getContestAwardsConfig(
  contestId: number,
): Promise<ContestAwardsConfig> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { config: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (contest?.config as any) || {};
  const awards = config.awards || {};
  return {
    enabled: Boolean(awards.enabled),
    base: awards.base || {},
    firstToSolve: Boolean(awards.firstToSolve),
    excellenceAward: Boolean(awards.excellenceAward),
    excellenceCitation: awards.excellenceCitation,
    topThree: Boolean(awards.topThree),
    topThreeCitations: awards.topThreeCitations || {},
    custom: Array.isArray(awards.custom) ? awards.custom : [],
  };
}

/**
 * 每题一血：计算每道题第一个 AC 的队伍（含打星队伍）。
 * 只看比赛窗口内的提交，按提交时间排序后每道题取第一个 AC。
 */
export async function getFirstSolves(
  contestId: number,
): Promise<FirstSolveInfo[]> {
  const [contest, contestProblems, submissions] = await Promise.all([
    prisma.contest.findUnique({
      where: { id: contestId },
      select: { endTime: true },
    }),
    prisma.contestProblem.findMany({
      where: { contestId },
      select: { problemId: true, displayId: true },
      orderBy: { displayId: "asc" },
    }),
    prisma.submission.findMany({
      where: {
        contestId,
        verdict: Verdict.ACCEPTED,
        user: { role: "TEAM" },
      },
      select: {
        problemId: true,
        submittedAt: true,
        user: { select: { username: true } },
      },
      orderBy: { submittedAt: "asc" },
    }),
  ]);

  if (!contest) return [];

  const endMs = contest.endTime.getTime();
  const firstByProblem = new Map<
    number,
    { username: string; submittedAt: Date }
  >();
  for (const s of submissions) {
    if (s.submittedAt.getTime() > endMs) continue;
    if (firstByProblem.has(s.problemId)) continue;
    if (!s.user?.username) continue;
    firstByProblem.set(s.problemId, {
      username: s.user.username,
      submittedAt: s.submittedAt,
    });
  }

  return contestProblems
    .map((cp) => {
      const first = firstByProblem.get(cp.problemId);
      if (!first) return null;
      return {
        problemId: cp.problemId,
        displayId: cp.displayId,
        username: first.username,
        submittedAt: first.submittedAt,
      };
    })
    .filter((x): x is FirstSolveInfo => x !== null);
}

/**
 * 计算比赛最终榜单（与排行榜页的计分口径一致）：
 * - 只看比赛窗口内的提交（submittedAt <= endTime）
 * - 排除 CE / SE
 * - 每道题取第一次 AC 的时间计罚时：floor(分钟) + 之前错误次数 * 20
 * - 按 solved 降序、penalty 升序排序
 */
export async function computeContestStandings(
  contestId: number,
): Promise<StandingRow[]> {
  const [contest, teams, contestProblems] = await Promise.all([
    prisma.contest.findUnique({
      where: { id: contestId },
      select: { startTime: true, endTime: true },
    }),
    prisma.user.findMany({
      where: { contestId, role: "TEAM" },
      select: {
        username: true,
        displayName: true,
        school: true,
        category: true,
        submissions: {
          where: { contestId },
          select: { problemId: true, verdict: true, submittedAt: true },
        },
      },
    }),
    prisma.contestProblem.findMany({
      where: { contestId },
      select: { problemId: true },
    }),
  ]);

  if (!contest) return [];

  const problemIds = new Set(contestProblems.map((cp) => cp.problemId));
  const startMs = contest.startTime.getTime();
  const endMs = contest.endTime.getTime();

  const rows: StandingRow[] = teams.map((team) => {
    const submissions = team.submissions
      .filter(
        (s) =>
          problemIds.has(s.problemId) &&
          s.verdict !== Verdict.COMPILE_ERROR &&
          s.verdict !== Verdict.SYSTEM_ERROR &&
          s.submittedAt.getTime() <= endMs,
      )
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());

    // 每题统计：AC 前错误次数 + AC 时间
    const perProblem = new Map<
      number,
      { wa: number; acTime: number | null }
    >();
    for (const s of submissions) {
      const cur = perProblem.get(s.problemId) || { wa: 0, acTime: null };
      if (cur.acTime !== null) continue; // AC 之后的提交不计
      if (s.verdict === Verdict.ACCEPTED) {
        cur.acTime = s.submittedAt.getTime();
      } else {
        cur.wa++;
      }
      perProblem.set(s.problemId, cur);
    }

    let solved = 0;
    let penalty = 0;
    for (const { wa, acTime } of perProblem.values()) {
      if (acTime === null) continue;
      solved++;
      penalty += Math.floor((acTime - startMs) / 60000) + wa * 20;
    }

    return {
      username: team.username,
      displayName: team.displayName,
      school: team.school,
      category: team.category,
      isStar: team.category === "1",
      solved,
      penalty,
    };
  });

  rows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty);
  return rows;
}

/**
 * 生成 resolver 可识别的 awards 事件列表：
 * 金银铜按最终正式榜单顺序分配，之后是自定义奖项。
 */
export async function getFeedAwards(contestId: number): Promise<FeedAward[]> {
  const cfg = await getContestAwardsConfig(contestId);
  if (!cfg.enabled) return [];

  const [standings, medal] = await Promise.all([
    computeContestStandings(contestId),
    getContestMedalConfig(contestId),
  ]);

  const official = standings.filter((t) => !t.isStar);
  const counts = getMedalCounts(official.length, medal);

  const awards: FeedAward[] = [];

  // 金银铜：与 ICPC Tools award 工具一致，每条奖牌额外生成一条
  // display_mode="list" 的副本（resolver 用它展示完整获奖名单）
  const pushMedal = (id: string, citation: string, teams: StandingRow[]) => {
    if (teams.length === 0) return;
    const teamIds = teams.map((t) => t.username);
    awards.push({ id, citation: citation || id, team_ids: teamIds });
    awards.push({
      id: `id-${Math.random()}`,
      citation: citation || id,
      team_ids: teamIds,
      display_mode: "list",
    });
  };

  const goldTeams = official.slice(0, counts.gold);
  const silverTeams = official.slice(counts.gold, counts.gold + counts.silver);
  const bronzeTeams = official.slice(
    counts.gold + counts.silver,
    counts.gold + counts.silver + counts.bronze,
  );

  pushMedal("gold-medal", cfg.base?.gold || "Gold Medal", goldTeams);
  pushMedal("silver-medal", cfg.base?.silver || "Silver Medal", silverTeams);
  pushMedal("bronze-medal", cfg.base?.bronze || "Bronze Medal", bronzeTeams);

  // 优秀奖：未获金银铜、但解出至少 1 题的队伍
  if (cfg.excellenceAward) {
    const medalTeamIds = new Set(
      [...goldTeams, ...silverTeams, ...bronzeTeams].map((t) => t.username),
    );
    const teams = official.filter(
      (t) => t.solved > 0 && !medalTeamIds.has(t.username),
    );
    if (teams.length > 0) {
      awards.push({
        id: `id-${Math.random()}`,
        citation: cfg.excellenceCitation || "优秀奖",
        team_ids: teams.map((t) => t.username),
      });
    }
  }

  // 冠军/亚军/季军：按学校去重，每个学校最多一个席位，取该校最好队伍
  if (cfg.topThree) {
    const seats: { id: string; citation: string }[] = [
      {
        id: "champion",
        citation: cfg.topThreeCitations?.champion || "冠军",
      },
      {
        id: "runner-up",
        citation: cfg.topThreeCitations?.runnerUp || "亚军",
      },
      {
        id: "third-place",
        citation: cfg.topThreeCitations?.third || "季军",
      },
    ];
    const schoolsSeen = new Set<string>();
    for (const seat of seats) {
      const team = official.find(
        (t) => !schoolsSeen.has(t.school ?? "__none__"),
      );
      if (!team) break; // 学校数不足时，后续奖项不再生成
      schoolsSeen.add(team.school ?? "__none__");
      awards.push({
        id: seat.id,
        citation: seat.citation,
        team_ids: [team.username],
      });
    }
  }

  // 快速解题奖：每题一血，按队伍合并（含打星队伍）
  // citation 采用 DOMjudge 格式：First to solve problem A / problems A and B / A, B, C and D
  if (cfg.firstToSolve) {
    const firstSolves = await getFirstSolves(contestId);
    const labelsByTeam = new Map<string, string[]>();
    firstSolves.forEach((fs) => {
      const arr = labelsByTeam.get(fs.username) || [];
      arr.push(fs.displayId);
      labelsByTeam.set(fs.username, arr);
    });
    let ftsIndex = 0;
    standings.forEach((t) => {
      const labels = labelsByTeam.get(t.username);
      if (!labels || labels.length === 0) return;
      ftsIndex++;
      awards.push({
        id: `first-to-solve-${ftsIndex}`,
        citation: formatFtsCitation(labels),
        team_ids: [t.username],
      });
    });
  }

  cfg.custom.forEach((custom, index) => {
    const teamIds = Array.isArray(custom.teamIds) ? custom.teamIds : [];
    if (teamIds.length === 0) return;
    awards.push({
      id: custom.id || `special-${index + 1}`,
      citation: custom.citation || `Special Award ${index + 1}`,
      team_ids: teamIds,
    });
  });

  return awards;
}
