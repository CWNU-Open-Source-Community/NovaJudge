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

  if (!contest) {
    return {
      title: "比赛未找到",
    };
  }
  return {
    title: `题目列表 - ${contest.title}`,
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
    return <div>Contest not found</div>;
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
  const runningVp =
    !userId && globalUserId
      ? await getRunningVirtualParticipation(contestId, String(globalUserId))
      : null;
  const latestVp =
    !userId && globalUserId
      ? await getLatestVirtualParticipation(contestId, String(globalUserId))
      : null;

  // 封榜统计逻辑
  const config = contestInfo?.config as { frozenDuration?: number } | null;
  const frozenDuration = config?.frozenDuration ?? 0;
  const endTime = contestInfo?.endTime;

  let dateFilter = {};

  if (frozenDuration > 0 && endTime) {
    const freezeTime = new Date(endTime.getTime() - frozenDuration * 60 * 1000);
    dateFilter = {
      submittedAt: {
        lt: freezeTime,
      },
    };
  }

  if (runningVp) {
    const now = new Date();
    dateFilter = {
      submittedAt: {
        lte: new Date(
          Math.min(
            contestInfo.startTime.getTime() +
              (now.getTime() - runningVp.startedAt.getTime()),
            contestInfo.endTime.getTime(),
          ),
        ),
      },
    };
  }

  const totalStats = await prisma.submission.groupBy({
    by: ["problemId"],
    where: { contestId: contestId, virtualParticipationId: null, ...dateFilter },
    _count: { _all: true },
  });

  const acStats = await prisma.submission.groupBy({
    by: ["problemId"],
    where: {
      contestId: contestId,
      verdict: Verdict.ACCEPTED,
      virtualParticipationId: null,
      ...dateFilter,
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

  const userStats =
    userId || globalUserId
      ? await prisma.submission.findMany({
          where: {
            contestId: contestId,
            verdict: Verdict.ACCEPTED,
            ...(userId
              ? { userId }
              : latestVp
                ? { virtualParticipationId: latestVp.id }
                : { id: "__never__" }),
          },
          select: {
            problemId: true,
          },
        })
      : [];

  const statsMap = new Map(userStats.map((s) => [s.problemId, 1]));

  const dict = await getDictionary();

  return (
    <div className="bg-white w-full mx-auto shadow-sm border border-gray-100 rounded-sm p-3 sm:p-6">
      <h2 className="mb-6 text-2xl font-serif font-bold text-gray-800 sm:pl-2">
        {dict.problemList.title}
      </h2>
      {contestInfo?.status === ContestStatus.PENDING ? (
        <div className="text-center py-10 text-gray-500">
          {dict.contestList.noContestsFound}
        </div>
      ) : (
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="min-w-190 w-full text-sm font-serif text-left text-gray-600">
            <thead className="whitespace-nowrap text-base text-gray-700 bg-white border-b border-gray-400 border-t sm:text-lg">
              <tr>
                <th scope="col" className="w-20 px-3 py-2 text-center sm:w-24 sm:px-6">
                  {dict.problemDetail.status}
                </th>
                <th scope="col" className="w-20 px-3 py-2 sm:w-24 sm:px-6">
                  ID
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.problemDetail.title}
                </th>
                <th scope="col" className="w-52 px-3 py-2 sm:w-80 sm:px-6">
                  {dict.problemDetail.ratio} ({dict.problemDetail.accepted} /{" "}
                  {dict.problemDetail.submissions})
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-center sm:w-24 sm:px-6">
                  {dict.problemDetail.balloon}
                </th>
              </tr>
            </thead>
            <tbody>
              {contestProblem.map((prob) => {
                const acceptedCount = acMap.get(prob.problemId) || 0;
                const totalCount = totalMap.get(prob.problemId) || 0;
                const rate =
                  totalCount > 0 ? (acceptedCount / totalCount) * 100 : 0;
                return (
                  <tr
                    key={prob.id}
                    className="h-10 border-b border-gray-300 text-sm transition-colors odd:bg-white even:bg-[#f4f7fa] hover:bg-blue-50 sm:text-base"
                    >
                    <td className="px-3 py-2 sm:px-6">
                      <div className="flex min-h-6 items-center justify-center">
                        {(statsMap.get(prob.problemId) || 0) !== 0 && (
                          <svg
                            className="icon"
                            viewBox="0 0 1024 1024"
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            p-id="13161"
                            width="22"
                            height="22"
                          >
                            <path
                              d="M86.528 491.666286a45.787429 45.787429 0 0 1 64.731429 0l247.954285 247.954285 506.88-506.806857a45.787429 45.787429 0 0 1 64.731429 64.731429L431.616 836.754286a45.787429 45.787429 0 0 1-64.658286 0L86.528 556.324571a45.787429 45.787429 0 0 1 0-64.658285z"
                              fill="#2CA641"
                              p-id="13162"
                            ></path>
                          </svg>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-900 sm:px-6">
                      <div className="flex gap-2 items-center">
                        {prob.displayId}
                      </div>
                    </td>
                    <td className="max-w-0 px-3 py-2 novajudge-problem-link sm:px-6">
                      <Link
                        href={`/contest/${contestId}/problems/${prob.displayId}`}
                        className="block truncate text-blue-600 hover:underline hover:text-blue-800"
                        title={prob.problem.title}
                      >
                        {prob.problem.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-left sm:px-6">
                      {rate.toFixed(2)}% ({acceptedCount} / {totalCount})
                    </td>
                    <td className="px-3 py-2 sm:px-6">
                      <div className="flex items-center justify-center">
                        <svg
                          viewBox="0 0 512 512"
                          width="24"
                          height="24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fill={prob?.color || "#6b7280"}
                            d="M391 307.27c32.75-46.35 46.59-101.63 39-155.68C416.47 55.59 327.38-11.54 231.38 2S68.24 104.53 81.73 200.53c7.57 53.89 36.12 103.16 80.37 138.74c26.91 21.64 57.59 36.1 86.05 41.33l-8.36 45.23a8 8 0 0 0 9 9.38L279 431c15.9 35.87 41.65 60.48 78.41 75l14.88 5.88l11.77-29.75l-14.88-5.89c-26.35-10.42-44.48-26.16-57-49.92l21.84-3.07a8 8 0 0 0 6.05-11.49l-20.49-41.16c25.98-12.87 51.49-35.18 71.42-63.33m-160.82 15.66c-41.26-16.32-76.3-52.7-91.45-94.94l-5.4-15.06l30.12-10.8l5.4 15.06c14.5 40.44 47.27 65.77 73.1 76l14.88 5.88l-11.77 29.76Z"
                          />
                        </svg>
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
