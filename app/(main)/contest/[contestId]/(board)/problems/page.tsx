import { requireContestAccess } from "@/lib/contest-access";
import Link from "next/link";
import { ContestStatus, Verdict } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { getDictionary } from "@/lib/get-dictionary";
import { Metadata } from "next";
import {
  getLatestVirtualParticipation,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";
import { getDomjudgeContest } from "@/lib/domjudge-contest";
import { DomjudgeProblemset } from "@/components/contest/DomjudgeProblemset";
import { scoreboardClock } from "@/lib/domjudge-scoreboard";
import { formatMessage, getVerdictLabel } from "@/lib/dictionaries";
import { problemColorStyle } from "@/lib/problem-badge";
import { verdictPillClass } from "@/lib/verdict-style";
import { getViewerProblemProgress } from "@/lib/viewer-problem-progress";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

interface Props {
  params: Promise<{
    contestId: string;
  }>;
}

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
  return {
    title: `${dict.problemList.title} - ${contest.title}`,
    generator: "NovaJudge Contest",
  };
}

export default async function Problems({ params }: Props) {
  const contestId = Number((await params).contestId);
  await requireContestAccess(contestId);

  // const contestInfo = await getContestData(contestId);
  const contestInfo = await prisma.contest.findUnique({
    where: {
      id: contestId,
    },
  });

  if (!contestInfo) {
    return <div>{(await getDictionary()).contestList.notFound}</div>;
  }

  const domjudge = await getDomjudgeContest(contestId);
  if (domjudge) {
    const now = new Date();
    return <DomjudgeProblemset contest={domjudge} now={now} freezeAt={scoreboardClock(contestInfo, now).freezeAt} />;
  }

  // 1. 鉴权逻辑：必须登录比赛账号或全局管理员
  const user = await getCurrentUser();
  const globalUser = await getCurrentSuper();
  const userPayload = user as UserJwtPayload | null;

  const contestProblem = await prisma.contestProblem.findMany({
    where: {
      contestId: contestId,
    },
    orderBy: {
      displayId: "asc",
    },
    include: {
      problem: true,
    },
  });

  const userId = userPayload?.userId;
  const globalUserId = (globalUser as unknown as UserJwtPayload)?.userId;
  const isExternalUser =
    Boolean(globalUser?.externalId) && !globalUser?.isGlobalAdmin;
  const isContestEnded =
    contestInfo.status === ContestStatus.ENDED ||
    new Date() >= contestInfo.endTime;
  const runningVp =
    !userId && globalUserId
      ? await getRunningVirtualParticipation(contestId, String(globalUserId))
      : null;
  const latestVp =
    !userId && globalUserId
      ? await getLatestVirtualParticipation(contestId, String(globalUserId))
      : null;

  // 封榜统计逻辑
  const config = contestInfo.config as { frozenDuration?: number } | null;
  const frozenDuration = config?.frozenDuration ?? 0;
  let officialVisibleUntil = contestInfo.endTime;
  let officialUpperBoundExclusive = false;

  if (frozenDuration > 0) {
    officialVisibleUntil = new Date(
      contestInfo.endTime.getTime() - frozenDuration * 60 * 1000,
    );
    officialUpperBoundExclusive = true;
  }

  if (runningVp) {
    const now = new Date();
    officialVisibleUntil = new Date(
      Math.min(
        contestInfo.startTime.getTime() +
          (now.getTime() - runningVp.startedAt.getTime()),
        contestInfo.endTime.getTime(),
      ),
    );
    officialUpperBoundExclusive = false;
  }

  const officialWhere = getOfficialSubmissionWhere({
    contestId,
    startTime: contestInfo.startTime,
    endTime: contestInfo.endTime,
    visibleUntil: officialVisibleUntil,
    exclusiveUpperBound: officialUpperBoundExclusive,
  });

  const totalStats = await prisma.submission.groupBy({
    by: ["problemId"],
    where: officialWhere,
    _count: { _all: true },
  });

  const acStats = await prisma.submission.groupBy({
    by: ["problemId"],
    where: {
      ...officialWhere,
      verdict: Verdict.ACCEPTED,
    },
    _count: { _all: true },
  });
  const totalMap = new Map(totalStats.map((s) => [s.problemId, s._count._all]));
  const acMap = new Map(acStats.map((s) => [s.problemId, s._count._all]));

  if (latestVp) {
    const [vpTotalStats, vpAcStats] = await Promise.all([
      prisma.submission.groupBy({
        by: ["problemId"],
        where: {
          contestId,
          virtualParticipationId: latestVp.id,
          submittedAt: {
            gte: latestVp.startedAt,
            lte: latestVp.endedAt,
          },
        },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ["problemId"],
        where: {
          contestId,
          virtualParticipationId: latestVp.id,
          verdict: Verdict.ACCEPTED,
          submittedAt: {
            gte: latestVp.startedAt,
            lte: latestVp.endedAt,
          },
        },
        _count: { _all: true },
      }),
    ]);

    for (const stat of vpTotalStats) {
      totalMap.set(
        stat.problemId,
        (totalMap.get(stat.problemId) || 0) + stat._count._all,
      );
    }

    for (const stat of vpAcStats) {
      acMap.set(
        stat.problemId,
        (acMap.get(stat.problemId) || 0) + stat._count._all,
      );
    }
  }

  // 当前用户每道题的通过、评测中与尝试次数
  const { progress } = await getViewerProblemProgress(contestId, {
    userId,
    globalUserId,
    runningVpId: runningVp?.id,
    latestVpId: latestVp?.id,
    externalAfterContest: isExternalUser && isContestEnded,
  });

  const dict = await getDictionary();
  const showPersonal = Boolean(userId || globalUserId);
  const solvedCount = contestProblem.filter((prob) => progress.get(prob.problemId)?.state === "solved").length;
  const isPending = contestInfo?.status === ContestStatus.PENDING;

  return (
    <div className="w-full mx-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:px-2">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {dict.problemList.title}
        </h2>
        {showPersonal && !isPending && contestProblem.length > 0 && (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="tabular-nums">
              {formatMessage(dict.problemList.solvedSummary, {
                solved: solvedCount,
                total: contestProblem.length,
              })}
            </span>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={contestProblem.length}
              aria-valuenow={solvedCount}
              className="h-2 w-28 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 ring-inset sm:w-36"
            >
              <div
                className="h-full rounded-full bg-linear-to-r from-emerald-400 to-emerald-600"
                style={{ width: `${(solvedCount / contestProblem.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {isPending ? (
        <div className="text-center py-10 text-slate-500">
          {dict.problemList.empty}
        </div>
      ) : (
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="min-w-160 w-full text-left text-sm text-slate-600">
            <thead className="whitespace-nowrap border-y border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="w-20 px-3 py-2.5 text-center sm:px-4">
                  {dict.problemDetail.id}
                </th>
                <th scope="col" className="px-3 py-2.5 sm:px-4">
                  {dict.problemDetail.title}
                </th>
                <th scope="col" className="w-40 px-3 py-2.5 sm:px-4">
                  {dict.problemDetail.status}
                </th>
                <th scope="col" className="w-60 px-3 py-2.5 sm:px-4">
                  {dict.problemDetail.ratio} ({dict.problemDetail.accepted} /{" "}
                  {dict.problemDetail.submissions})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contestProblem.map((prob) => {
                const acceptedCount = acMap.get(prob.problemId) || 0;
                const totalCount = totalMap.get(prob.problemId) || 0;
                const rate =
                  totalCount > 0 ? (acceptedCount / totalCount) * 100 : 0;
                const entry = progress.get(prob.problemId);
                const solved = entry?.state === "solved";
                const pending = entry?.state === "pending";
                const tries = entry?.tries ?? 0;
                const href = `/contest/${contestId}/problems/${prob.displayId}`;
                return (
                  <tr
                    key={prob.id}
                    className={`group transition-colors hover:bg-slate-50 ${solved ? "bg-emerald-50/50" : ""}`}
                  >
                    <td className="px-3 py-3 text-center sm:px-4">
                      <Link
                        href={href}
                        tabIndex={-1}
                        aria-hidden="true"
                        title={prob.color ? `${dict.problemDetail.balloon}: ${prob.color}` : undefined}
                        className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-100 text-base font-bold text-slate-800 shadow-sm ring-1 ring-black/10 ring-inset transition-transform group-hover:scale-105"
                        style={problemColorStyle(prob.color)}
                      >
                        {prob.displayId}
                      </Link>
                    </td>
                    <td className="max-w-0 px-3 py-3 novajudge-problem-link sm:px-4">
                      <Link
                        href={href}
                        className="block truncate text-base font-semibold text-slate-900 hover:underline group-hover:text-blue-700"
                        title={prob.problem.title}
                      >
                        <span className="sr-only">{prob.displayId}. </span>
                        {prob.problem.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon aria-hidden="true" className="size-3.5" />
                          {prob.problem.defaultTimeLimit} ms
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CpuChipIcon aria-hidden="true" className="size-3.5" />
                          {prob.problem.defaultMemoryLimit} MB
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 sm:px-4">
                      {solved ? (
                        <span className={verdictPillClass(Verdict.ACCEPTED)}>
                          <CheckCircleIcon aria-hidden="true" className="size-4" />
                          {dict.problemDetail.accepted}
                        </span>
                      ) : pending ? (
                        <span className={verdictPillClass(Verdict.JUDGING)}>
                          <ArrowPathIcon aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                          {getVerdictLabel(Verdict.PENDING)}
                        </span>
                      ) : tries > 0 ? (
                        <span className={verdictPillClass("REJECTED")}>
                          <XCircleIcon aria-hidden="true" className="size-4" />
                          {formatMessage(dict.problemList.attempted, { count: tries })}
                        </span>
                      ) : (
                        <span className="text-slate-300">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{dict.rank.noSubmission}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 sm:px-4">
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${rate}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-slate-700">
                          <span className="font-semibold text-slate-900">{acceptedCount}</span> / {totalCount}
                        </span>
                        <span className="text-xs tabular-nums text-slate-400">
                          {rate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
