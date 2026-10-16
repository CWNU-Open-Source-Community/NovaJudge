import { requireContestAccess } from "@/lib/contest-access";
import { getCurrentSuper, verifyAuth } from "@/lib/auth";
import {
  ContestRole,
  ContestStatus,
  Verdict,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import Link from "next/link";
import RankSearch from "./RankSearch";
import RankTable from "./RankTable";
import { ContestConfig } from "@/app/(main)/page";
import UnfreezeButton from "./UnfreezeButton";
import ExportEventFeedButton from "./ExportEventFeedButton";
import ExportRankResultsButton from "./ExportRankResultsButton";
import ExportRankPdfButton from "./ExportRankPdfButton";
import { getDictionary } from "@/lib/get-dictionary";
import { Metadata } from "next";
import {
  getLatestVirtualParticipationsForContest,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";
import IncludeVpToggle from "./IncludeVpToggle";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);

  const contest = await prisma.contest.findFirst({
    where: {
      id: contestId,
    },
  });

  if (!contest) {
    return {
      title: "比赛未找到",
    };
  }
  return {
    title: `排行榜 - ${contest.title}`,
  };
}

// 辅助函数：计算时间差（计算逻辑不变，仅展示换算后的总分钟数）
function formatTime(startTime: number, submissionTime: number): string {
  const diffMs = submissionTime - startTime;
  const minutes = Math.floor(diffMs / 60000);
  return `${minutes}`;
}

function isStarTeam(category: string | null) {
  return category === "1";
}

function getMedalCounts(total: number, config: ContestConfig | null) {
  const medal = config?.medal || {
    mode: "ratio" as const,
    gold: 0,
    silver: 0,
    bronze: 0,
  };
  const mode = medal.mode || "ratio";
  const gold = Math.max(0, Number(medal.gold || 0));
  const silver = Math.max(0, Number(medal.silver || 0));
  const bronze = Math.max(0, Number(medal.bronze || 0));

  if (mode === "fixed") {
    return {
      gold: Math.min(total, Math.floor(gold)),
      silver: Math.min(total, Math.floor(silver)),
      bronze: Math.min(total, Math.floor(bronze)),
    };
  }

  return {
    gold: Math.min(total, Math.ceil((total * gold) / 100)),
    silver: Math.min(total, Math.ceil((total * silver) / 100)),
    bronze: Math.min(total, Math.ceil((total * bronze) / 100)),
  };
}

function getTextDisplayWidth(text: string | null | undefined) {
  return Array.from(text || "").reduce((width, char) => {
    return width + (char.charCodeAt(0) > 255 ? 2 : 1);
  }, 0);
}

interface Props {
  searchParams: Promise<{
    teamName?: string;
    school?: string;
    category?: string;
    includeVp?: string;
  }>;
  params: Promise<{
    contestId: string;
  }>;
}

export default async function Rank({ params, searchParams }: Props) {
  const { contestId } = await params;
  const { teamName, school, category, includeVp } = await searchParams;

  const cid = parseInt(contestId);
  await requireContestAccess(cid);
  const shouldIncludeVpInRank = includeVp !== "0";

  // 1. 获取比赛信息
  const contestInfo = await prisma.contest.findUnique({
    where: { id: cid },
  });

  if (!contestInfo) {
    return (
      <div className="text-center py-10 text-gray-500">Contest not found.</div>
    );
  }

  // 2. 权限校验
  const cookieStore = await cookies();
  const token = cookieStore.get("user_token")?.value;
  const payload = token ? await verifyAuth(token).catch(() => null) : null;
  const glabelPayload = await getCurrentSuper();

  let currentUser = null;
  let isTeamMember = false;
  let isGlobalAdmin = false;
  let isContestAdmin = false;

  if (glabelPayload?.isGlobalAdmin) {
    isGlobalAdmin = true;
  }

  if (payload?.userId) {
    currentUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        contestId: true,
      },
    });

    isTeamMember =
      currentUser?.contestId === cid && currentUser?.role === ContestRole.TEAM;

    isContestAdmin =
      currentUser?.contestId === cid && currentUser?.role === ContestRole.ADMIN;
  }

  // 3. 构建查询条件
  const config = contestInfo.config as ContestConfig;
  const now = new Date();
  const runningViewerVp =
    !payload?.userId && glabelPayload?.userId && !glabelPayload.isGlobalAdmin
      ? await getRunningVirtualParticipation(
          cid,
          String(glabelPayload.userId),
          now,
        )
      : null;
  const isViewerRunningVp = Boolean(runningViewerVp);
  const showUpsolving = !isViewerRunningVp;
  const effectiveNow = runningViewerVp
    ? new Date(
        Math.min(
          contestInfo.startTime.getTime() +
            (now.getTime() - runningViewerVp.startedAt.getTime()),
          contestInfo.endTime.getTime(),
        ),
      )
    : now;
  const freezeTime =
    contestInfo.endTime.getTime() - config?.frozenDuration * 60 * 1000;

  // 判断是否处于封榜显示状态
  // 条件：当前时间 >= 封榜时间 且 比赛未结束 (或者结束后管理员未解榜，这里假设封榜时间持续有效)
  // 如果 contestInfo.freezeTime 存在，且当前时间超过了它，就是封榜状态
  const isFrozen =
    config?.frozenDuration !== 0 &&
    (freezeTime ? effectiveNow.getTime() >= freezeTime : false);

  // 管理员可以看到实时榜单
  const canSeeLiveBoard = isGlobalAdmin || isContestAdmin;
  // 普通用户（包括未登录）看到的榜单是否应该是封榜状态
  const shouldShowFrozenState = isFrozen && !canSeeLiveBoard;

  // 4. 获取队伍和提交
  const allTeams = await prisma.user.findMany({
    where: {
      contestId: cid,
      role: ContestRole.TEAM,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      members: true,
      school: true,
      category: true,
      submissions: {
        where: { contestId: cid },
        select: {
          id: true,
          displayId: true,
          problemId: true,
          verdict: true,
          submittedAt: true,
        },
      },
    },
  });

  // 5. 获取题目
  const contestProblems = await prisma.contestProblem.findMany({
    where: { contestId: cid },
    select: {
      problemId: true,
      displayId: true,
      color: true,
    },
    orderBy: {
      displayId: "asc",
    },
  });

  // === 预先计算所有题目的一血 (全局最早AC) ===
  // 避免在循环中查询数据库 (N+1问题)
  const latestVirtualParticipations =
    await getLatestVirtualParticipationsForContest(cid);

  const allAcSubmissions = await prisma.submission.findMany({
    where: {
      contestId: cid,
      verdict: Verdict.ACCEPTED,
      virtualParticipationId: null,
      ...(runningViewerVp ? { submittedAt: { lte: effectiveNow } } : {}),
    },
    select: {
      id: true,
      problemId: true,
      displayId: true,
      submittedAt: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
  });

  // Map<ProblemId, SubmissionId>
  const firstBloodMap = new Map<
    number,
    { submissionId: string; relativeTimeMs: number }
  >();
  for (const sub of allAcSubmissions) {
    // 因为是按时间正序排列的，第一次遇到某个 problemId，就是该题的一血
    const relativeTimeMs =
      sub.submittedAt.getTime() - contestInfo.startTime.getTime();
    const current = firstBloodMap.get(sub.problemId);
    if (!current || relativeTimeMs < current.relativeTimeMs) {
      firstBloodMap.set(sub.problemId, { submissionId: sub.id, relativeTimeMs });
    }
  }

  for (const vp of latestVirtualParticipations) {
    for (const sub of vp.submissions) {
      if (sub.verdict !== Verdict.ACCEPTED) continue;

      const submittedAt = sub.submittedAt.getTime();
      if (
        submittedAt < vp.startedAt.getTime() ||
        submittedAt > vp.endedAt.getTime()
      ) {
        continue;
      }

      const relativeTimeMs = submittedAt - vp.startedAt.getTime();
      const current = firstBloodMap.get(sub.problemId);
      if (!current || relativeTimeMs < current.relativeTimeMs) {
        firstBloodMap.set(sub.problemId, {
          submissionId: sub.id,
          relativeTimeMs,
        });
      }
    }
  }

  // 6. 计算排名
  const startTimeMs = contestInfo.startTime.getTime();
  const end = runningViewerVp
    ? effectiveNow.getTime()
    : contestInfo.endTime.getTime();
  const freezeTimeMs = freezeTime ? new Date(freezeTime).getTime() : Infinity;

  // 排行榜数据接口定义
  interface TeamRankData {
    rank: number | string;
    medal?: "Gold" | "Silver" | "Bronze" | "";
    id: string;
    username: string;
    displayName: string | null;
    members: string | null;
    school: string | null;
    category: string | null;
    isVirtual?: boolean;
    solved: number;
    penalty: number;
    problems: Array<{
      problemId: number;
      displayId: string;
      color: string | null;
      firstBlood: boolean;
      accepted: boolean;
      time: string;
      tries: number; // 用于显示 (- 3)
      frozenTries: number; // 封榜后的提交次数 (? 2)
      unfrozenTries: number; // 封榜前的WA次数 (? 2 / - 1)
      firstAcceptedSubmissionId?: number;
      upsolved: boolean; // 是否赛后补题通过
    } | null>;
  }

  const allTeamRankings: TeamRankData[] = await Promise.all(
    allTeams.map(async (team) => {
      let solved = 0;
      let penalty = 0;

      const problems = await Promise.all(
        contestProblems.map(async (cp) => {
          // 过滤掉 CE 和 SE 的提交
          const rawSubmissions = team.submissions.filter(
            (s) =>
              s.problemId === cp.problemId &&
              s.verdict !== Verdict.COMPILE_ERROR &&
              s.verdict !== Verdict.SYSTEM_ERROR,
            // s.submittedAt.getTime() <= end
          );

          if (rawSubmissions.length === 0) {
            return null;
          }

          // 分离赛中提交和赛后提交
          const contestSubmissions = rawSubmissions.filter(
            (s) => new Date(s.submittedAt).getTime() <= end,
          );
          const afterContestSubmissions = showUpsolving
            ? rawSubmissions.filter(
                (s) =>
                  new Date(s.submittedAt).getTime() >
                  contestInfo.endTime.getTime(),
              )
            : [];

          // 按时间排序
          const submissions = contestSubmissions.sort(
            (a, b) =>
              new Date(a.submittedAt).getTime() -
              new Date(b.submittedAt).getTime(),
          );

          // === 计算逻辑开始 ===
          // 我们需要根据 `shouldShowFrozenState` 决定 solved/penalty 的计算方式
          // 以及返回给前端的单元格状态

          let isAccepted = false;
          let acceptedTimeMs = 0;
          let acceptedSubId = 0;
          let acceptedSubmissionId = "";
          let waCountBeforeAcc = 0;

          // 1. 先计算【真实】情况（用于管理员或检测是否AC）
          for (const sub of submissions) {
            if (sub.verdict === Verdict.ACCEPTED) {
              isAccepted = true;
              acceptedTimeMs =
                new Date(sub.submittedAt).getTime() - startTimeMs;
              acceptedSubId = sub.displayId;
              acceptedSubmissionId = sub.id;
              break; // AC 后不再计算罚时次数
            }
            waCountBeforeAcc++;
          }

          // 2. 如果是封榜状态，需要计算【封榜前】的状态
          let isAcceptedBeforeFreeze = false;
          let waCountBeforeFreeze = 0; // 封榜前的错误次数
          let frozenTries = 0; // 封榜后的提交次数

          if (shouldShowFrozenState && freezeTime) {
            // 重新遍历计算封榜逻辑
            for (const sub of submissions) {
              const subTime = new Date(sub.submittedAt).getTime();

              if (subTime < freezeTimeMs) {
                // 封榜前的提交
                if (sub.verdict === Verdict.ACCEPTED) {
                  // 如果还没记录过AC（取第一次AC）
                  if (!isAcceptedBeforeFreeze) {
                    isAcceptedBeforeFreeze = true;
                    // 如果封榜前AC了，计算罚时就用封榜前的数据
                    // 这里覆盖上面的真实数据，只用于 Rank 排序
                    // 下面的 problems 返回对象中再做区分
                  }
                  break; // 封榜前已经AC，后面的都不看了
                } else {
                  waCountBeforeFreeze++;
                }
              } else {
                // 封榜后的提交，不管对错，都算一次尝试
                // 注意：如果封榜前已经AC了，通常排行榜上就不显示封榜后的提交了，而是直接显示绿色的AC
                if (!isAcceptedBeforeFreeze) {
                  frozenTries++;
                }
              }
            }
          }

          // === 决定最终用于【排序】的 Solved 和 Penalty ===
          if (shouldShowFrozenState) {
            // 封榜模式：只统计封榜前的 AC
            if (isAcceptedBeforeFreeze) {
              solved++;
              // 罚时 = AC时间(分钟) + 错误次数 * 20
              // 注意：AC时间必须是第一发AC的时间，我们上面循环里还没有抓取封榜前AC的具体时间
              // 简单处理：找到封榜前那个AC submission
              const preFreezeAC = submissions.find(
                (s) =>
                  s.verdict === Verdict.ACCEPTED &&
                  new Date(s.submittedAt).getTime() < freezeTimeMs,
              );
              if (preFreezeAC) {
                const t =
                  new Date(preFreezeAC.submittedAt).getTime() - startTimeMs;
                penalty += Math.floor(t / 60000) + waCountBeforeFreeze * 20;
              }
            }
            // 如果封榜前没AC，不管封榜后有没有AC，Solved和Penalty都不加
          } else {
            // 实时模式：统计真实数据
            if (isAccepted) {
              solved++;
              penalty +=
                Math.floor(acceptedTimeMs / 60000) + waCountBeforeAcc * 20;
            }
          }

          // === 决定返回给【前端展示】的数据 ===
          // 检查该题目是否是一血 (First Blood)
          // 注意：通常一血是基于实时数据的，即使在封榜后，管理员看也是一血。
          // 普通用户看封榜数据，所谓的一血应该是封榜前产生的一血。封榜后产生的一血普通用户看不到是谁。
          let firstBlood = false;
          // 只有当显示的也是AC状态时，才去查是否一血
          const showAsAccepted = shouldShowFrozenState
            ? isAcceptedBeforeFreeze
            : isAccepted;

          const globalFirstBlood = firstBloodMap.get(cp.problemId);

          if (showAsAccepted && globalFirstBlood) {
            const myAcceptedSubmissionId = shouldShowFrozenState
              ? submissions.find(
                  (s) =>
                    s.verdict === Verdict.ACCEPTED &&
                    new Date(s.submittedAt).getTime() < freezeTimeMs,
                )?.id
              : acceptedSubmissionId;

            // 如果当前展示的提交 ID 等于全局一血 ID，那就是一血
            if (myAcceptedSubmissionId === globalFirstBlood.submissionId) {
              firstBlood = true;
            }
          }

          // 构造返回对象
          // 时间：显示 AC 的时间
          let displayTime = "";
          if (showAsAccepted) {
            // 找到对应AC提交的时间
            const acSub = submissions.find((s) => {
              if (shouldShowFrozenState)
                return (
                  s.verdict === Verdict.ACCEPTED &&
                  new Date(s.submittedAt).getTime() < freezeTimeMs
                );
              return s.displayId === acceptedSubId;
            });
            if (acSub) {
              displayTime = formatTime(
                startTimeMs,
                new Date(acSub.submittedAt).getTime(),
              );
            }
          }

          let upsolved = false;
          let upsolvedSubmissionId: number | undefined;
          // 只有当赛中状态判定为未通过时，才去检查 Upsolving
          // 如果 showAsAccepted 为 true，说明已经 AC 了（无论是实时还是封榜前），就不算 Upsolved
          const finalShowAccepted = shouldShowFrozenState
            ? isAcceptedBeforeFreeze
            : isAccepted;

          if (!finalShowAccepted) {
            // 查找赛后的第一次 AC
            const afterContestAC = afterContestSubmissions.find(
              (s) => s.verdict === Verdict.ACCEPTED,
            ); // 注意：afterContestSubmissions 通常没有排序，最好 sort 或者 find 之前确认顺序
            // 前面 rawSubmissions 是根据 filter 分出来的，可能顺序是对的，
            // 但为了保险，对 afterContestSubmissions 也做一次时间排序

            if (afterContestAC) {
              upsolved = true;
              upsolvedSubmissionId = afterContestAC.displayId; // 记录 ID
            }
          }

          let finalLinkSubmissionId: number | undefined;

          if (finalShowAccepted) {
            // 赛中AC逻辑（保持原有）
            finalLinkSubmissionId = shouldShowFrozenState
              ? submissions.find(
                  (s) =>
                    s.verdict === Verdict.ACCEPTED &&
                    new Date(s.submittedAt).getTime() < freezeTimeMs,
                )?.displayId
              : acceptedSubId;
          } else if (upsolved) {
            // 赛后AC逻辑
            finalLinkSubmissionId = upsolvedSubmissionId;
          }

          return {
            problemId: cp.problemId,
            displayId: cp.displayId,
            color: cp.color,
            firstBlood,
            accepted: finalShowAccepted, // 前端显示绿色的依据
            time: displayTime,
            tries: shouldShowFrozenState
              ? waCountBeforeFreeze
              : waCountBeforeAcc, // 红色 (- X) 的数字
            frozenTries: frozenTries, // 蓝色 (? X) 的数字 (仅在 !accepted 时有效)
            unfrozenTries: waCountBeforeFreeze, // 蓝色 (? Y / - X) 中的 X
            firstAcceptedSubmissionId: finalLinkSubmissionId,
            upsolved: upsolved, // 传递给前端
          };
        }),
      );

      return {
        rank: 0,
        medal: "",
        id: team.id,
        username: team.username,
        displayName: team.displayName,
        members: team.members,
        school: team.school,
        category: team.category,
        isVirtual: false,
        solved,
        penalty: Math.floor(penalty),
        problems,
      };
    }),
  );

  // 排序
  allTeamRankings.sort((a, b) => {
    if (a.solved !== b.solved) return b.solved - a.solved;
    return a.penalty - b.penalty;
  });

  // 计算 Rank (处理并列)
  for (let i = 0; i < allTeamRankings.length; i++) {
    if (
      i > 0 &&
      allTeamRankings[i].solved === allTeamRankings[i - 1].solved &&
      allTeamRankings[i].penalty === allTeamRankings[i - 1].penalty
    ) {
      allTeamRankings[i].rank = allTeamRankings[i - 1].rank;
    } else {
      allTeamRankings[i].rank = i + 1;
    }
  }

  const officialTeams = allTeamRankings.filter(
    (team) => !isStarTeam(team.category),
  );
  const medalCounts = getMedalCounts(officialTeams.length, config);
  officialTeams.forEach((team, index) => {
    if (index < medalCounts.gold) team.medal = "Gold";
    else if (index < medalCounts.gold + medalCounts.silver)
      team.medal = "Silver";
    else if (index < medalCounts.gold + medalCounts.silver + medalCounts.bronze)
      team.medal = "Bronze";
  });

  let displayTeamRankings = allTeamRankings.filter((team) => {
    if (
      teamName &&
      !`${team.displayName || ""} ${team.username}`
        .toLowerCase()
        .includes(teamName.toLowerCase())
    ) {
      return false;
    }

    if (
      school &&
      !`${team.school || ""}`.toLowerCase().includes(school.toLowerCase())
    ) {
      return false;
    }

    if (category) {
      if (category === "0") {
        return team.category === "0" || team.category === "2";
      }
      return team.category === category;
    }

    return true;
  });
  const myTeamRank = isTeamMember
    ? allTeamRankings.find((team) => team.id === currentUser?.id)
    : null;

  // 获取所有的 School 和 Category 用于筛选
  const allSchools = await prisma.user.findMany({
    where: { contestId: cid, role: ContestRole.TEAM },
    select: { school: true },
    distinct: ["school"],
  });

  const allCategories = await prisma.user.findMany({
    where: { contestId: cid, role: ContestRole.TEAM },
    select: { category: true },
    distinct: ["category"],
  });
  const isContestEnded =
    contestInfo.status === ContestStatus.ENDED || now > contestInfo.endTime;
  const showUnfreezeButton = canSeeLiveBoard && isContestEnded && isFrozen;
  const canOpenRankSubmissions = isContestEnded && !runningViewerVp;

  const dict = await getDictionary();

  const globalRanks: TeamRankData[] = [];
  const globalUpsolvingRanks: TeamRankData[] = [];
  // 收集所有在本比赛中有提交的全局用户
  const globalSubmissionUsers = showUpsolving
    ? await prisma.submission.findMany({
        where: {
          contestId: cid,
          globalUserId: { not: null },
          virtualParticipationId: null,
        },
        select: { globalUserId: true },
        distinct: ["globalUserId"],
      })
    : [];
  const globalIds = Array.from(
    new Set([
      ...latestVirtualParticipations.map((vp) => vp.globalUserId),
      ...globalSubmissionUsers
        .map((submission) => submission.globalUserId)
        .filter((id): id is string => Boolean(id)),
    ]),
  );
  if (globalIds.length > 0) {
    const globalUsers = await prisma.globalUser.findMany({
      where: { id: { in: globalIds } },
      select: { id: true, username: true, displayName: true },
    });
    for (const gu of globalUsers) {
      const currentVp = latestVirtualParticipations.find(
        (vp) => vp.globalUserId === gu.id,
      );
      const vpStartTimeMs = currentVp?.startedAt.getTime() ?? startTimeMs;
      const vpEndTimeMs = currentVp?.endedAt.getTime() ?? startTimeMs;
      const globalSubs = await prisma.submission.findMany({
        where: {
          contestId: cid,
          globalUserId: gu.id,
          virtualParticipationId: currentVp?.id ?? "__NO_VP__",
        },
        select: {
          id: true,
          displayId: true,
          problemId: true,
          verdict: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "asc" },
      });
      const previousVpSubs = showUpsolving
        ? await prisma.submission.findMany({
            where: {
              contestId: cid,
              globalUserId: gu.id,
              OR: [
                { virtualParticipationId: null },
                ...(currentVp
                  ? [
                      {
                        AND: [
                          { virtualParticipationId: { not: null } },
                          { virtualParticipationId: { not: currentVp.id } },
                        ],
                      },
                    ]
                  : []),
              ],
            },
            select: {
              id: true,
              displayId: true,
              problemId: true,
              verdict: true,
              submittedAt: true,
            },
            orderBy: { submittedAt: "asc" },
          })
        : [];
      let solved = 0;
      let penalty = 0;
      const problems = await Promise.all(
        contestProblems.map(async (cp) => {
          const startTimeMs = vpStartTimeMs;
          const end = vpEndTimeMs;
          const shouldShowFrozenState = false;
          const rawSubmissions = globalSubs.filter(
            (s) =>
              s.problemId === cp.problemId &&
              s.verdict !== Verdict.COMPILE_ERROR &&
              s.verdict !== Verdict.SYSTEM_ERROR,
          );
          const afterContestSubmissions: typeof rawSubmissions = [];
          if (rawSubmissions.length === 0) return null;
          const contestSubmissions = rawSubmissions.filter(
            (s) => new Date(s.submittedAt).getTime() <= end,
          );
          const submissions = contestSubmissions.sort(
            (a, b) =>
              new Date(a.submittedAt).getTime() -
              new Date(b.submittedAt).getTime(),
          );
          let isAccepted = false;
          let acceptedTimeMs = 0;
          let acceptedSubId = 0;
          let acceptedSubmissionId = "";
          let waCountBeforeAcc = 0;
          for (const sub of submissions) {
            if (sub.verdict === Verdict.ACCEPTED) {
              isAccepted = true;
              acceptedTimeMs =
                new Date(sub.submittedAt).getTime() - startTimeMs;
              acceptedSubId = sub.displayId;
              acceptedSubmissionId = sub.id;
              break;
            }
            waCountBeforeAcc++;
          }
          let isAcceptedBeforeFreeze = false;
          let waCountBeforeFreeze = 0;
          let frozenTries = 0;
          if (shouldShowFrozenState && freezeTime) {
            for (const sub of submissions) {
              const subTime = new Date(sub.submittedAt).getTime();
              if (subTime < freezeTimeMs) {
                if (sub.verdict === Verdict.ACCEPTED) {
                  if (!isAcceptedBeforeFreeze) {
                    isAcceptedBeforeFreeze = true;
                  }
                  break;
                } else {
                  waCountBeforeFreeze++;
                }
              } else {
                if (!isAcceptedBeforeFreeze) {
                  frozenTries++;
                }
              }
            }
          }
          if (shouldShowFrozenState) {
            if (isAcceptedBeforeFreeze) {
              solved++;
              const preFreezeAC = submissions.find(
                (s) =>
                  s.verdict === Verdict.ACCEPTED &&
                  new Date(s.submittedAt).getTime() < freezeTimeMs,
              );
              if (preFreezeAC) {
                const t =
                  new Date(preFreezeAC.submittedAt).getTime() - startTimeMs;
                penalty += Math.floor(t / 60000) + waCountBeforeFreeze * 20;
              }
            }
          } else {
            if (isAccepted) {
              solved++;
              penalty +=
                Math.floor(acceptedTimeMs / 60000) + waCountBeforeAcc * 20;
            }
          }
          let firstBlood = false;
          const showAsAccepted = shouldShowFrozenState
            ? isAcceptedBeforeFreeze
            : isAccepted;
          const globalFirstBlood = firstBloodMap.get(cp.problemId);
          if (showAsAccepted && globalFirstBlood) {
            const myAcceptedSubmissionId = shouldShowFrozenState
              ? submissions.find(
                  (s) =>
                    s.verdict === Verdict.ACCEPTED &&
                    new Date(s.submittedAt).getTime() < freezeTimeMs,
                )?.id
              : acceptedSubmissionId;
            if (myAcceptedSubmissionId === globalFirstBlood.submissionId) {
              firstBlood = true;
            }
          }
          let displayTime = "";
          if (showAsAccepted) {
            const acSub = submissions.find((s) => {
              if (shouldShowFrozenState)
                return (
                  s.verdict === Verdict.ACCEPTED &&
                  new Date(s.submittedAt).getTime() < freezeTimeMs
                );
              return s.displayId === acceptedSubId;
            });
            if (acSub) {
              displayTime = formatTime(
                startTimeMs,
                new Date(acSub.submittedAt).getTime(),
              );
            }
          }
          let upsolved = false;
          let upsolvedSubmissionId: number | undefined;
          const finalShowAccepted = shouldShowFrozenState
            ? isAcceptedBeforeFreeze
            : isAccepted;
          if (!finalShowAccepted) {
            const afterContestAC = afterContestSubmissions.find(
              (s) => s.verdict === Verdict.ACCEPTED,
            );
            if (afterContestAC) {
              upsolved = true;
              upsolvedSubmissionId = afterContestAC.displayId;
            }
          }
          let finalLinkSubmissionId: number | undefined;
          if (finalShowAccepted) {
            finalLinkSubmissionId = shouldShowFrozenState
              ? submissions.find(
                  (s) =>
                    s.verdict === Verdict.ACCEPTED &&
                    new Date(s.submittedAt).getTime() < freezeTimeMs,
                )?.displayId
              : acceptedSubId;
          } else if (upsolved) {
            finalLinkSubmissionId = upsolvedSubmissionId;
          }
          return {
            problemId: cp.problemId,
            displayId: cp.displayId,
            color: cp.color,
            firstBlood,
            accepted: finalShowAccepted,
            time: displayTime,
            tries: shouldShowFrozenState
              ? waCountBeforeFreeze
              : waCountBeforeAcc,
            frozenTries,
            unfrozenTries: waCountBeforeFreeze,
            firstAcceptedSubmissionId: finalLinkSubmissionId,
            upsolved,
          };
        }),
      );
      if (currentVp) {
        globalRanks.push({
          rank: "*",
          id: currentVp.id,
          username: gu.username,
          displayName: gu.displayName,
          members: null,
          school: null,
          category: "VP",
          isVirtual: true,
          solved,
          penalty: Math.floor(penalty),
          problems,
        });
      }

      if (showUpsolving && previousVpSubs.length > 0) {
        let upsolvedCount = 0;
        const upsolvingProblems = contestProblems.map((cp) => {
          const submissions = previousVpSubs.filter(
            (s) =>
              s.problemId === cp.problemId &&
              s.verdict !== Verdict.COMPILE_ERROR &&
              s.verdict !== Verdict.SYSTEM_ERROR,
          );
          const acceptedSubmission = submissions.find(
            (s) => s.verdict === Verdict.ACCEPTED,
          );

          if (!acceptedSubmission) return null;

          upsolvedCount++;
          return {
            problemId: cp.problemId,
            displayId: cp.displayId,
            color: cp.color,
            firstBlood: false,
            accepted: false,
            time: "",
            tries: submissions.filter(
              (s) =>
                s.submittedAt <= acceptedSubmission.submittedAt &&
                s.verdict !== Verdict.ACCEPTED,
            ).length,
            frozenTries: 0,
            unfrozenTries: 0,
            firstAcceptedSubmissionId: acceptedSubmission.displayId,
            upsolved: true,
          };
        });

        if (upsolvedCount > 0) {
          globalUpsolvingRanks.push({
            rank: "*",
            id: `global-upsolve-${gu.id}`,
            username: gu.username,
            displayName: gu.displayName,
            members: null,
            school: null,
            category: null,
            isVirtual: false,
            solved: upsolvedCount,
            penalty: 0,
            problems: upsolvingProblems,
          });
        }
      }
    }
    // 排序：按解决问题数量降序
    globalRanks.sort((a, b) => b.solved - a.solved);
    globalUpsolvingRanks.sort((a, b) => b.solved - a.solved);
  }

  if (shouldIncludeVpInRank && globalRanks.length > 0) {
    const combinedRankings = [...allTeamRankings, ...globalRanks];
    combinedRankings.sort((a, b) => {
      if (a.solved !== b.solved) return b.solved - a.solved;
      return a.penalty - b.penalty;
    });

    for (let i = 0; i < combinedRankings.length; i++) {
      if (isStarTeam(combinedRankings[i].category)) {
        combinedRankings[i].rank = "*";
      } else if (
        i > 0 &&
        combinedRankings[i].solved === combinedRankings[i - 1].solved &&
        combinedRankings[i].penalty === combinedRankings[i - 1].penalty
      ) {
        combinedRankings[i].rank = combinedRankings[i - 1].rank;
      } else {
        combinedRankings[i].rank = i + 1;
      }
    }

    displayTeamRankings = combinedRankings.filter((team) => {
      if (
        teamName &&
        !`${team.displayName || ""} ${team.username}`
          .toLowerCase()
          .includes(teamName.toLowerCase())
      ) {
        return false;
      }

      if (
        school &&
        !`${team.school || ""}`.toLowerCase().includes(school.toLowerCase())
      ) {
        return false;
      }

      if (category) {
        if (category === "0") {
          return team.category === "0" || team.category === "2";
        }
        return team.category === category;
      }

      return true;
    });
  }

  const myVpRank =
    !payload?.userId && glabelPayload?.userId && !glabelPayload.isGlobalAdmin
      ? globalRanks.find((team) => {
          const vp = latestVirtualParticipations.find(
            (participation) => participation.id === team.id,
          );
          return vp?.globalUserId === String(glabelPayload.userId);
        })
      : null;
  const myRank = myTeamRank || myVpRank;
  const visibleRankTables = [
    ...(myRank ? [myRank] : []),
    ...displayTeamRankings,
    ...(showUpsolving ? globalUpsolvingRanks : []),
  ];
  const maxTeamTextWidth = visibleRankTables.reduce((maxWidth, team) => {
    const prefixWidth =
      (team.category === "1" || team.category === "2" ? 2 : 0) +
      (team.isVirtual ? 4 : 0);

    return Math.max(
      maxWidth,
      prefixWidth + getTextDisplayWidth(team.displayName || team.username),
      getTextDisplayWidth(team.members || team.username),
      getTextDisplayWidth(team.school),
    );
  }, 0);
  const desiredTeamColumnWidthPercent = Math.max(
    12,
    Math.min(24, maxTeamTextWidth * 0.65 + 6),
  );
  const maxTeamColumnWidthPercent = contestProblems.length >= 12 ? 16 : 22;
  const teamColumnWidthPercent = Math.min(
    desiredTeamColumnWidthPercent,
    maxTeamColumnWidthPercent,
  );

  return (
    <div className="bg-white w-full mx-auto shadow-sm border border-gray-100 rounded-sm p-3 sm:p-6">
      <div className="flex flex-col gap-3 border-b mb-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-serif font-bold text-gray-800 sm:pl-2 flex flex-wrap items-center gap-y-2">
          Rank
          {showUnfreezeButton && <UnfreezeButton contest={{ id: contestInfo.id, config: contestInfo.config }} />}
          {canSeeLiveBoard && (
            <span className="ml-2 flex items-center gap-2">
              <ExportRankResultsButton contestId={cid} />
              <ExportEventFeedButton contestId={cid} />
            </span>
          )}
          {isGlobalAdmin && (
            <span className="ml-2 flex items-center gap-2">
              <Link
                href={`/admin/contests/${cid}/awards`}
                className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 transition-colors shadow-sm"
                title="快速设置奖项并导出含奖项的 Event Feed（用于 ICPC Tools resolver 滚榜）"
              >
                🏅 奖项设置
              </Link>
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <ExportRankPdfButton contestId={contestId} />
          <IncludeVpToggle defaultChecked={shouldIncludeVpInRank} />
          <RankSearch
            schools={
              allSchools.map((s) => s.school).filter(Boolean) as string[]
            }
            categories={
              allCategories.map((c) => c.category).filter(Boolean) as string[]
            }
          />
        </div>
      </div>

      {shouldShowFrozenState && (
        <div className="mb-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
          <p className="text-blue-800 font-semibold flex items-center gap-2">
            <span>❄️</span>
            <span>当前已封榜，等待管理员解榜</span>
          </p>
        </div>
      )}

      {contestInfo.status === ContestStatus.PENDING ? (
        <div className="text-center py-10 text-gray-500">
          {dict.contestList.noContestsFound}
        </div>
      ) : (
        <>
          {myRank && (
            <div className="mb-4 print:hidden">
              <RankTable
                contestId={contestId}
                teams={[myRank]}
                isMyTeam={true}
                isContestEnded={canOpenRankSubmissions}
                contestProblems={contestProblems}
                isFrozen={isFrozen}
                teamColumnWidthPercent={teamColumnWidthPercent}
              />
            </div>
          )}

          <RankTable
            contestId={contestId}
            teams={displayTeamRankings}
            isMyTeam={false}
            isContestEnded={canOpenRankSubmissions}
            contestProblems={contestProblems}
            isFrozen={isFrozen}
            teamColumnWidthPercent={teamColumnWidthPercent}
          />
          {showUpsolving && globalUpsolvingRanks.length > 0 && (
            <div className="mt-2">
              <RankTable
                contestId={contestId}
                teams={globalUpsolvingRanks}
                isMyTeam={false}
                isContestEnded={canOpenRankSubmissions}
                contestProblems={contestProblems}
                isFrozen={isFrozen}
                teamColumnWidthPercent={teamColumnWidthPercent}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
