import { requireContestAccess } from "@/lib/contest-access";
import type { CSSProperties } from "react";
import { getTeamInterface } from "@/lib/contest-interface";
import DomjudgeScoreboard from "@/components/contest/DomjudgeScoreboard";
import { boardTeamDetails, boardTeamInfo, type BoardQuery } from "@/lib/domjudge-scoreboard";
import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import {
  ContestRole,
  ContestStatus,
  Verdict,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import RankActions from "./RankActions";
import RankSearch from "./RankSearch";
import RankTable, { type RankTableTeam } from "./RankTable";
import { getContestTeamStandings, scoreboardFreezeTime, type TeamRankData } from "@/lib/contest-team-standings";
import { ContestConfig } from "@/app/(main)/page";
import UnfreezeButton from "./UnfreezeButton";
import ExportEventFeedButton from "./ExportEventFeedButton";
import ExportRankResultsButton from "./ExportRankResultsButton";
import { getDictionary } from "@/lib/get-dictionary";
import { formatMessage } from "@/lib/dictionaries";
import { Metadata } from "next";
import {
  getLatestVirtualParticipationsForContest,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";
import IncludeVpToggle from "./IncludeVpToggle";
import { summarizeRankProblems } from "@/lib/rank-problem-stats";
import { getOrganizationDirectory } from "@/lib/org-mapper";
import "./rank.css";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);

  const contest = await prisma.contest.findFirst({
    where: {
      id: contestId,
    },
  });

  const dict = await getDictionary();
  if (!contest) {
    return {
      title: dict.contestList.notFound,
    };
  }
  const viewer = await getTeamInterface();
  const title = viewer?.contestId === contestId && viewer.domjudge ? "Scoreboard" : dict.rank.title;
  return { title: `${title} - ${contest.title}` };
}

// 辅助函数：计算时间差（计算逻辑不变，仅展示换算后的总分钟数）
function formatTime(startTime: number, submissionTime: number): string {
  const diffMs = submissionTime - startTime;
  const minutes = Math.floor(diffMs / 60000);
  return `${minutes}`;
}

interface Props {
  searchParams: Promise<BoardQuery & {
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
  const query = await searchParams;
  const { teamName, school, category, includeVp } = query;

  const cid = parseInt(contestId);
  await requireContestAccess(cid);
  const dict = await getDictionary();
  const shouldIncludeVpInRank = includeVp !== "0";

  // 1. 获取比赛信息
  const contestInfo = await prisma.contest.findUnique({
    where: { id: cid },
  });

  if (!contestInfo) {
    return (
      <div className="text-center py-10 text-gray-500">{dict.contestList.notFound}</div>
    );
  }

  const viewer = await getTeamInterface();
  if (viewer?.contestId === cid && viewer.domjudge) {
    return <DomjudgeScoreboard contest={contestInfo} viewerId={viewer.userId} query={query} />;
  }

  // 2. 权限校验。有效的全局会话优先于比赛 Cookie。
  const glabelPayload = await getCurrentSuper();
  const payload = glabelPayload ? null : await getCurrentUser();

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
  const freezeTime = scoreboardFreezeTime(contestInfo.endTime, config?.frozenDuration);
  const isFrozen = effectiveNow.getTime() >= freezeTime;

  // 本场管理员和裁判可查看实时榜单并定位提交；其他管理操作保持原权限。
  const canManageSubmissions =
    isGlobalAdmin ||
    (currentUser?.contestId === cid &&
      (currentUser.role === ContestRole.ADMIN ||
        currentUser.role === ContestRole.JUDGE));
  const canSeeLiveBoard = canManageSubmissions;
  // 普通用户（包括未登录）看到的榜单是否应该是封榜状态
  const shouldShowFrozenState = isFrozen && !canSeeLiveBoard;

  const startTimeMs = contestInfo.startTime.getTime();
  const visibleUntil = runningViewerVp ? effectiveNow : contestInfo.endTime;
  const end = visibleUntil.getTime();
  const freezeTimeMs = shouldShowFrozenState ? freezeTime : Infinity;
  const [{ teams: allTeams, problems: contestProblems, rankings: allTeamRankings, firstSolves }, latestVirtualParticipations, organizations] =
    await Promise.all([
      getContestTeamStandings(contestInfo, { visibleUntil, freezeAt: freezeTimeMs, includeUpsolving: showUpsolving, includeCoach: true }),
      getLatestVirtualParticipationsForContest(cid),
      getOrganizationDirectory(),
    ]);

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
  const canManageContest = isGlobalAdmin || isContestAdmin;
  const showUnfreezeButton = canManageContest && isContestEnded && isFrozen;
  const canOpenRankSubmissions = isContestEnded && !runningViewerVp;


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
          const globalFirstBlood = firstSolves.get(cp.problemId);
          if (showAsAccepted && globalFirstBlood) {
            const myAcceptedSubmissionId = shouldShowFrozenState
              ? submissions.find(
                  (s) =>
                    s.verdict === Verdict.ACCEPTED &&
                    new Date(s.submittedAt).getTime() < freezeTimeMs,
                )?.id
              : acceptedSubmissionId;
            if (myAcceptedSubmissionId === globalFirstBlood.id) {
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
  const visibleTeamIds = new Set(displayTeamRankings.map((team) => team.contestUserId));
  const problemStats = summarizeRankProblems(
    contestProblems.map((problem) => problem.problemId),
    allTeams.filter((team) => visibleTeamIds.has(team.id)),
    {
      start: startTimeMs,
      end: Math.min(end, effectiveNow.getTime()),
      freezeAt: shouldShowFrozenState ? freezeTimeMs : undefined,
    },
  );
  function rankRow(team: TeamRankData): RankTableTeam {
    return {
      ...boardTeamDetails(team, boardTeamInfo(team, organizations)),
      rank: team.rank, medal: team.medal, solved: team.solved, penalty: team.penalty, problems: team.problems,
      contestUserId: team.contestUserId, isVirtual: team.isVirtual,
    };
  }

  const largestScore = [...allTeamRankings, ...globalRanks, ...globalUpsolvingRanks].reduce(
    (largest, team) => Math.max(largest, team.solved, team.penalty), 0,
  );
  return (
    <div className="contest-panel contest-standings bg-white w-full mx-auto rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4"
      style={{ "--rank-problems": contestProblems.length, "--rank-score-digits": String(Math.floor(largestScore)).length } as CSSProperties}>
      {shouldShowFrozenState && contestInfo.status !== ContestStatus.PENDING && (
        <div className="md:hidden print:hidden">
          <p className="dj-freeze-notice" role="status">{formatMessage(dict.rank.freezeNotice, { minutes: config.frozenDuration })}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2 md:mb-4 md:border-b md:border-gray-200 md:px-0 md:pt-0 md:pb-4 print:hidden">
        <h2 className="hidden text-2xl font-bold tracking-tight text-slate-900 md:block">{dict.rank.title}</h2>
        <RankActions>
          {showUnfreezeButton && <UnfreezeButton contest={{ id: contestInfo.id, config: contestInfo.config }} />}
          {canManageContest && <>
            <ExportRankResultsButton contestId={cid} />
            <ExportEventFeedButton contestId={cid} />
          </>}
          {isGlobalAdmin && (
            <Link
              href={`/admin/contests/${cid}/awards`}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 transition-colors shadow-sm"
              title={dict.rank.awardsHint}
            >
              🏅 {dict.rank.awards}
            </Link>
          )}
          <IncludeVpToggle defaultChecked={shouldIncludeVpInRank} />
          {canManageSubmissions && <p className="text-xs text-gray-600 md:hidden">{dict.rank.manageHint}</p>}
        </RankActions>
        <RankSearch
          schools={allSchools.map((s) => s.school).filter(Boolean) as string[]}
          categories={allCategories.map((c) => c.category).filter(Boolean) as string[]}
        />
      </div>

      {canManageSubmissions && (
        <p className="mb-3 hidden text-xs text-gray-600 md:block print:hidden">
          {dict.rank.manageHint}
        </p>
      )}

      {shouldShowFrozenState && (
        <div className="nova-frozen-zone mb-4 hidden overflow-hidden rounded-xl ring-1 ring-sky-200 ring-inset md:block">
          <p className="flex items-center gap-2 bg-sky-50/90 px-4 py-3 font-semibold text-sky-800">
            <span aria-hidden="true">❄️</span>
            <span>{dict.rank.waitingForUnfreeze}</span>
          </p>
        </div>
      )}

      {contestInfo.status === ContestStatus.PENDING ? (
        <div className="text-center py-10 text-gray-500">
          {dict.contest.PENDING}
        </div>
      ) : (
        <>
          {myRank && (
            <div className="mb-4 print:hidden">
              <RankTable
                contestId={contestId}
                teams={[rankRow(myRank)]}
                isMyTeam={true}
                isContestEnded={canOpenRankSubmissions}
                canManageSubmissions={canManageSubmissions}
                contestProblems={contestProblems}
                isFrozen={isFrozen}
              />
            </div>
          )}

          <RankTable
            contestId={contestId}
            teams={displayTeamRankings.map(rankRow)}
            isMyTeam={false}
            isContestEnded={canOpenRankSubmissions}
            canManageSubmissions={canManageSubmissions}
            contestProblems={contestProblems}
            isFrozen={isFrozen}
            problemStats={problemStats}
            statsBeforeFreeze={shouldShowFrozenState}
          />
          {showUpsolving && globalUpsolvingRanks.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{dict.rank.upsolving}</h3>
              <RankTable
                contestId={contestId}
                teams={globalUpsolvingRanks.map(rankRow)}
                isMyTeam={false}
                isContestEnded={canOpenRankSubmissions}
                canManageSubmissions={canManageSubmissions}
                contestProblems={contestProblems}
                isFrozen={isFrozen}
                tableLabel={dict.rank.upsolving}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
