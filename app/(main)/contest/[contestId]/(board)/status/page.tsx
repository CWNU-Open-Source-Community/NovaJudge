import { requireContestAccess } from "@/lib/contest-access";
import Link from "next/link";
import Pagination from "@/components/Pagination";
import {
  ContestRole,
  ContestStatus,
  Verdict,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import VerdictCell from "@/components/VerdictCell";
import StatusControls from "./StatusControls";
import SearchAndFilter from "./SearchAndFilter";
import { getCurrentSuper, verifyAuth } from "@/lib/auth";
import { cookies } from "next/headers";
import { ContestConfig } from "@/app/(main)/page";
import { getDictionary } from "@/lib/get-dictionary";
import { Metadata } from "next";
import { getLatestVirtualParticipation } from "@/lib/virtual-participation";
import { buildContestSubmissionWhere } from "@/lib/contest-submission-query";
import type { ContestSubmissionFilters as SubmissionFilters } from "@/lib/contest-rejudge-types";
import ContestSubmissionFilters from "./ContestSubmissionFilters";
import ContestRejudgePanel from "./ContestRejudgePanel";

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
    title: `提交状态 - ${contest.title}`,
  };
}
interface Props {
  searchParams: Promise<{
    page?: string;
    userId?: string;
    problem?: string;
    language?: string;
    verdict?: Verdict;
    userSearch?: string;
    viewAll?: string;
    runId?: string;
    from?: string;
    to?: string;
  }>;
  params: Promise<{
    contestId: string;
  }>;
}

export default async function Status({ params, searchParams }: Props) {
  const { contestId } = await params;
  const {
    page = "1",
    userId,
    problem,
    language,
    verdict,
    userSearch,
    viewAll = "false",
    runId,
    from,
    to,
  } = await searchParams;

  const currentPage = parseInt(page as string) || 1;
  const pageSize = 15;
  const cid = parseInt(contestId);
  await requireContestAccess(cid);

  // 1. 获取比赛信息
  const contestInfo = await prisma.contest.findUnique({
    where: { id: cid },
    select: {
      status: true,
      config: true,
      endTime: true,
    },
  });

  if (!contestInfo) {
    return (
      <div className="text-center py-10 text-gray-500">Contest not found.</div>
    );
  }

  // 2. 获取当前用户信息
  const cookieStore = await cookies();
  const token = cookieStore.get("user_token")?.value;
  const payload = token ? await verifyAuth(token).catch(() => null) : null;

  // 3. 获取当前用户在比赛中的角色
  let currentUser = null;
  if (payload?.userId) {
    currentUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        contestId: true,
      },
    });
  }

  const globalUser = await getCurrentSuper();
  // 4. 权限校验逻辑
  const isAdmin =
    !!globalUser?.isGlobalAdmin ||
    (currentUser &&
      currentUser.contestId === cid &&
      (currentUser.role === ContestRole.ADMIN ||
        currentUser.role === ContestRole.JUDGE));
  const latestVp =
    !currentUser && globalUser?.userId && !isAdmin
      ? await getLatestVirtualParticipation(cid, String(globalUser.userId))
      : null;
  const now = new Date();
  const isRunningVp =
    latestVp?.status === "RUNNING" &&
    latestVp.startedAt <= now &&
    latestVp.endedAt >= now;
  const isGuest = !currentUser && !globalUser && !isAdmin;
  const config = contestInfo.config as ContestConfig;
  const freezeTime = config?.frozenDuration
    ? contestInfo.endTime.getTime() - config?.frozenDuration * 60 * 1000
    : null;
  const isFrozen =
    config?.frozenDuration !== 0 &&
    (freezeTime ? new Date().getTime() >= freezeTime : false);
  const isContestEnded = contestInfo.status === ContestStatus.ENDED;
  const showTestDetails =
    contestInfo.status !== ContestStatus.RUNNING || Boolean(isAdmin);
  const canViewAll =
    !isRunningVp &&
    ((isContestEnded && !isFrozen) || isAdmin || isGuest || Boolean(latestVp));
  const canSearch =
    !isRunningVp &&
    ((isContestEnded && !isFrozen) || isAdmin || isGuest || Boolean(latestVp));

  // 用户选择查看所有提交且有权限
  const userWantsViewAll = isAdmin || viewAll === "true";
  const shouldViewAll = userWantsViewAll && canViewAll;

  const finalUserId = shouldViewAll ? userId : currentUser?.id;

  // 构建查询条件
  let where: Prisma.SubmissionWhereInput = {
    contestId: cid,
  };

  if (finalUserId) {
    where.userId = finalUserId;
  } else if (!shouldViewAll && latestVp) {
    where.virtualParticipationId = latestVp.id;
  }

  // 问题筛选
  if (problem && !isAdmin) {
    const contestProblem = await prisma.contestProblem.findFirst({
      where: {
        contestId: cid,
        displayId: problem,
      },
    });
    if (contestProblem) {
      where.problemId = contestProblem.problemId;
    }
  }

  // 语言筛选
  if (language) {
    where.language = language;
  }

  // 判题结果筛选
  if (verdict) {
    where.verdict = verdict;
  }

  // 用户搜索（模糊匹配用户名或displayName）
  if (userSearch && canSearch) {
    where.OR = [
      {
        user: {
          OR: [
            { username: { contains: userSearch, mode: "insensitive" } },
            { displayName: { contains: userSearch, mode: "insensitive" } },
          ],
        },
      },
      {
        globalUser: {
          OR: [
            { username: { contains: userSearch, mode: "insensitive" } },
            { displayName: { contains: userSearch, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const managerFilters: SubmissionFilters = { userId, userSearch, problem, language, verdict, runId, from, to };
  let filterError = "";
  if (isAdmin) {
    try {
      where = await buildContestSubmissionWhere(cid, managerFilters);
    } catch (error) {
      filterError = error instanceof Error ? error.message : "筛选条件无效，请重新选择。";
      where = { contestId: cid, id: { in: [] } };
    }
  }

  const [totalCount, submissions, allProblems, allLanguages, allVerdicts, teams] =
    await Promise.all([
      prisma.submission.count({ where }),
      prisma.submission.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              school: true,
              seat: true,
            },
          },
          globalUser: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
          virtualParticipation: {
            select: {
              id: true,
              attemptNo: true,
            },
          },
          problem: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: {
          submittedAt: "desc",
        },
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
      }),
      // 获取所有问题用于筛选
      prisma.contestProblem.findMany({
        where: { contestId: cid },
        select: {
          displayId: true,
          problemId: true,
          problem: { select: { title: true } },
        },
        orderBy: { displayId: "asc" },
      }),
      // 获取所有语言
      prisma.submission
        .findMany({
          where: { contestId: cid },
          select: { language: true },
          distinct: ["language"],
        })
        .then((results) => results.map((r) => r.language)),
      // 获取所有判题结果
      prisma.submission
        .findMany({
          where: { contestId: cid },
          select: { verdict: true },
          distinct: ["verdict"],
        })
        .then((results) => results.map((r) => r.verdict)),
      isAdmin ? prisma.user.findMany({
        where: { contestId: cid },
        select: { id: true, username: true, displayName: true, school: true, seat: true },
        orderBy: { username: "asc" },
      }) : Promise.resolve([]),
    ]);

  const displaySubmissions = submissions.map((submission) => {
    if (
      isGuest &&
      isFrozen &&
      freezeTime &&
      submission.submittedAt.getTime() >= freezeTime
    ) {
      return {
        ...submission,
        timeUsed: null,
        memoryUsed: null,
        language: "-",
        verdict: "FROZEN",
      };
    }

    if (!showTestDetails) {
      return {
        ...submission,
        passedTests: 0,
        totalTests: 0,
      };
    }

    return submission;
  });

  const problemIdMap = new Map(
    allProblems.map((cp) => [cp.problemId, cp.displayId]),
  );

  const languageRecord: Record<string, string> = {
    cpp: "C++",
    pypy3: "PyPy3",
    java: "Java",
    c: "C",
  };

  const verdictRecord: Record<string, string> = {
    [Verdict.ACCEPTED]: "Accepted",
    [Verdict.WRONG_ANSWER]: "Wrong Answer",
    [Verdict.TIME_LIMIT_EXCEEDED]: "Time Limit Exceeded",
    [Verdict.MEMORY_LIMIT_EXCEEDED]: "Memory Limit Exceeded",
    [Verdict.RUNTIME_ERROR]: "Runtime Error",
    [Verdict.COMPILE_ERROR]: "Compile Error",
    [Verdict.SYSTEM_ERROR]: "System Error",
  };

  const statusLabel =
    isAdmin ? "（本场全部提交）" : !shouldViewAll && currentUser
      ? "(Your Submissions)"
      : !shouldViewAll && latestVp
        ? `(Your latest VP #${latestVp.attemptNo})`
      : isContestEnded
        ? "(Contest Ended - All Submissions Visible)"
        : "";

  const dict = await getDictionary();

  return (
    <div className="bg-white w-full mx-auto shadow-sm border border-gray-100 rounded-sm p-3 sm:p-6">
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-serif font-bold text-gray-800">
          {dict.submission.title}{" "}
          <span className="block text-sm text-gray-500 sm:inline">
            {statusLabel}
          </span>
        </h2>
        {!isAdmin && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <SearchAndFilter
            canSearch={canSearch}
            problems={allProblems}
            languages={allLanguages}
            verdicts={allVerdicts}
            verdictRecord={verdictRecord}
            languageRecord={languageRecord}
          />
          {(currentUser || latestVp) && (
            <StatusControls canViewAll={canViewAll} />
          )}
        </div>}
      </div>

      {isAdmin && <ContestSubmissionFilters
        key={JSON.stringify(managerFilters)}
        filters={managerFilters}
        teams={teams}
        problems={allProblems.map((cp) => ({ displayId: cp.displayId, title: cp.problem.title }))}
        languages={allLanguages}
        verdicts={Object.values(Verdict)}
        languageRecord={languageRecord}
        verdictRecord={verdictRecord}
      />}
      {filterError && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{filterError}</p>}
      {isAdmin ? <ContestRejudgePanel
        key={cid}
        scopeKey={`${JSON.stringify(managerFilters)}:${currentPage}`}
        contestId={cid}
        filters={managerFilters}
        totalCount={totalCount}
        disabled={Boolean(filterError)}
        submissions={submissions.map((submission) => ({
          id: submission.id,
          displayId: submission.displayId,
          teamName: submission.user?.displayName || submission.globalUser?.displayName || submission.user?.username || submission.globalUser?.username || "Unknown",
          username: submission.user?.username || submission.globalUser?.username || "",
          school: submission.user?.school || null,
          seat: submission.user?.seat || null,
          problemLabel: problemIdMap.get(submission.problemId) || "?",
          problemTitle: submission.problem.title,
          submittedAt: submission.submittedAt.toISOString(),
          language: languageRecord[submission.language] || submission.language,
          verdict: submission.verdict,
          timeUsed: submission.timeUsed,
          memoryUsed: submission.memoryUsed,
          passedTests: submission.passedTests,
          totalTests: submission.totalTests,
          errorMessage: submission.errorMessage,
          virtualAttempt: submission.virtualParticipation?.attemptNo ?? null,
        }))}
      /> : contestInfo.status === ContestStatus.PENDING ? (
        <div className="text-center py-10 text-gray-500">
          {dict.contestList.noContestsFound}
        </div>
      ) : displaySubmissions.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          {shouldViewAll
            ? "No submissions yet."
            : "You have no submissions yet."}
        </div>
      ) : (
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="min-w-[760px] w-full table-fixed text-center text-sm lg:min-w-0">
            <colgroup>
              <col className="w-16" />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-36" />
            </colgroup>
            <thead className="whitespace-nowrap bg-white font-serif text-sm font-bold text-gray-800 border-b border-gray-400 border-t-2 sm:text-base">
              <tr>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  Run ID
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.submitTime}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.user}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.problem}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.time}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.memory}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.language}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-6">
                  {dict.submission.status}
                </th>
              </tr>
            </thead>
            <tbody>
              {displaySubmissions.map((submission) => {
                const problemDisplayId =
                  problemIdMap.get(submission.problemId) || "?";
                const submitTime = new Date(
                  submission.submittedAt,
                ).toLocaleString("zh-CN");
                const submitterName =
                  submission.user?.displayName ||
                  submission.user?.username ||
                  submission.globalUser?.displayName ||
                  "Unknown";
                const timeText =
                  isGuest && !isContestEnded
                    ? "-"
                    : submission.timeUsed !== null
                      ? `${submission.timeUsed} ms`
                      : "-";
                const memoryText =
                  isGuest && !isContestEnded
                    ? "-"
                    : submission.memoryUsed !== null
                      ? `${submission.memoryUsed} KB`
                      : "-";
                const languageText = isGuest && !isContestEnded
                  ? "-"
                  : languageRecord[submission.language];
                const verdictTitle = (() => {
                  if (isGuest && !isContestEnded) return String(submission.verdict);
                  if (!showTestDetails) return String(submission.verdict);
                  if (submission.verdict === Verdict.WRONG_ANSWER)
                    return `Wrong Answer on test ${submission.passedTests + 1}`;
                  if (submission.verdict === Verdict.TIME_LIMIT_EXCEEDED)
                    return `Time Limit Exceeded on test ${submission.passedTests + 1}`;
                  if (submission.verdict === Verdict.MEMORY_LIMIT_EXCEEDED)
                    return `Memory Limit Exceeded on test ${submission.passedTests + 1}`;
                  if (submission.verdict === Verdict.RUNTIME_ERROR)
                    return `Runtime Error on test ${submission.passedTests + 1}`;
                  return String(submission.verdict);
                })();

                return (
                  <tr
                    key={submission.id}
                    className="h-10 border-b border-gray-100 text-center font-[Menlo] text-sm text-gray-700 transition-colors odd:bg-white even:bg-[#e7f3ff] hover:bg-blue-50 sm:text-[18px]"
                  >
                    <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 sm:px-4">
                      {submission.displayId}
                    </td>
                    <td
                      className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-sm sm:px-4"
                      title={submitTime}
                    >
                      {submitTime}
                    </td>
                    <td className="px-3 py-2 text-gray-900 sm:px-4">
                      <div className="mx-auto flex max-w-32 items-center justify-center gap-2 sm:max-w-36">
                        <span className="truncate" title={submitterName}>
                          {submitterName}
                        </span>
                        {submission.virtualParticipation && (
                          <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                            VP #{submission.virtualParticipation.attemptNo}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-gray-900 sm:px-4">
                      <Link
                        href={`/contest/${contestId}/problems/${problemDisplayId}`}
                        className="text-blue-500 hover:underline hover:text-blue-800"
                      >
                        {problemDisplayId}
                      </Link>
                    </td>
                    <td
                      className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 sm:px-4"
                      title={timeText}
                    >
                      {timeText}
                    </td>
                    <td
                      className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 sm:px-4"
                      title={memoryText}
                    >
                      {memoryText}
                    </td>
                    <td
                      className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 sm:px-4"
                      title={languageText}
                    >
                      {isGuest && !isContestEnded ? (
                        "-"
                      ) : (
                        <Link
                          href={`/contest/${contestId}/status/${submission.displayId}`}
                          className="text-blue-500 hover:underline hover:text-blue-800"
                        >
                          {languageRecord[submission.language]}
                        </Link>
                      )}
                    </td>
                    <td className="overflow-hidden px-3 py-2 sm:px-4">
                      <div
                        className="mx-auto max-w-full overflow-hidden text-ellipsis whitespace-nowrap [&>button]:max-w-full [&>button]:overflow-hidden [&>span]:max-w-full [&>span]:overflow-hidden [&>span>span]:truncate"
                        title={verdictTitle}
                      >
                        <VerdictCell
                          submission={{
                            id: submission.id,
                            verdict: submission.verdict,
                            passedTests: submission.passedTests,
                            totalTests: submission.totalTests,
                            errorMessage: submission.errorMessage,
                          }}
                          isGuest={isGuest && !isContestEnded}
                          showTestDetails={showTestDetails}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页组件 */}
      <div className="mt-6">
        <Pagination totalItems={totalCount} pageSize={pageSize} />
      </div>
    </div>
  );
}
