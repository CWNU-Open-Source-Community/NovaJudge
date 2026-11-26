import { requireContestAccess } from "@/lib/contest-access";
import { usesDomjudge } from "@/lib/contest-interface";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getCurrentSuper,
  getCurrentUser,
  UserJwtPayload,
} from "@/lib/auth";
import {
  ContestRole,
  ContestStatus,
  ContestType,
} from "@/lib/generated/prisma/client";
import VerdictBadge from "@/components/VerdictBadge";
import Link from "next/link";
import CodeViewer from "./CodeViewer";
import { ContestConfig } from "@/app/(main)/page";
import { getDictionary, getLanguage } from "@/lib/get-dictionary";
import { formatMessage, getLocale } from "@/lib/dictionaries";
import { getRunningVirtualParticipation } from "@/lib/virtual-participation";
import { ContestRejudgeButton } from "../RejudgeControls";

interface Props {
  params: Promise<{
    contestId: string;
    submissionId: string;
  }>;
}

export default async function SubmissionDetail({ params }: Props) {
  const { contestId, submissionId } = await params;
  const cid = parseInt(contestId);
  await requireContestAccess(cid);

  // 1. 获取比赛和提交信息
  const [contestInfo, submission] = await Promise.all([
    prisma.contest.findUnique({
      where: { id: cid },
      select: {
        status: true,
        config: true,
        startTime: true,
        endTime: true,
        type: true,
      },
    }),
    prisma.submission.findFirst({
      where: {
        contestId: cid,
        displayId: parseInt(submissionId),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            contestId: true,
          },
        },
        globalUser: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        problem: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
  ]);

  if (!contestInfo || !submission) return notFound();

  const globalUser = await getCurrentSuper();
  const user = globalUser ? null : await getCurrentUser();
  const userPayload = user as UserJwtPayload | null;
  const isContestEnded =
    contestInfo.status === ContestStatus.ENDED ||
    new Date() >= contestInfo.endTime;

  const isGlobalSubmissionOwner =
    Boolean(globalUser?.userId) &&
    submission.globalUserId === globalUser?.userId;

  // 2. 权限校验逻辑
  const payload = userPayload;
  const isGlobalAdmin = !!globalUser?.isGlobalAdmin;
  const runningVp =
    globalUser?.userId && !isGlobalAdmin
      ? await getRunningVirtualParticipation(cid, String(globalUser.userId))
      : null;

  const config = contestInfo.config as ContestConfig | null;
  const frozenDuration = Number(config?.frozenDuration || 0);
  const freezeTime =
    contestInfo.endTime.getTime() - frozenDuration * 60 * 1000;
  const isFrozen =
    frozenDuration > 0 && new Date().getTime() >= freezeTime;

  let currentUser = null;
  if (payload?.userId) {
    const candidate = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        contestId: true,
      },
    });

    // 其他比赛的账号在本场按普通访客处理，与提交列表保持一致。
    if (candidate?.contestId === cid) {
      currentUser = candidate;
    }
  }

  // 进行中的 VP 只允许查看当前轮；赛后详情可见性不受正式赛统计范围限制。
  const isContestSubmissionOwner =
    Boolean(currentUser?.id) && submission.userId === currentUser?.id;
  const isOwner =
    isContestSubmissionOwner ||
    (isGlobalSubmissionOwner &&
      (!runningVp || submission.virtualParticipationId === runningVp.id));
  const isAdmin =
    isGlobalAdmin ||
    currentUser?.role === ContestRole.ADMIN ||
    currentUser?.role === ContestRole.JUDGE;
  const canRejudge = isAdmin;
  const canViewEndedSubmission =
    isContestEnded &&
    !isFrozen &&
    !runningVp &&
    (contestInfo.type === ContestType.PUBLIC || Boolean(currentUser));

  if (!isOwner && !isAdmin && !canViewEndedSubmission) {
    return notFound();
  }

  // 非 VP 的赛后补题沿用公开代码规则；他人的 VP 仅展示提交信息。
  const canViewCode =
    isOwner ||
    isAdmin ||
    (canViewEndedSubmission && submission.virtualParticipationId === null);

  const contestProblem = await prisma.contestProblem.findFirst({
    where: {
      contestId: cid,
      problemId: submission.problemId,
    },
    select: {
      displayId: true,
    },
  });

  const [dict, lang, domjudge] = await Promise.all([getDictionary(), getLanguage(), usesDomjudge(cid)]);
  const home = `/contest/${contestId}`;
  let backHref = `${home}/status`;
  if (domjudge) {
    backHref = `${home}#dj-submissions`;
  } else if (canRejudge) {
    const filters = new URLSearchParams({ viewAll: "true" });
    if (submission.user?.id) filters.set("userId", submission.user.id);
    if (contestProblem?.displayId) filters.set("problem", contestProblem.displayId);
    backHref += `?${filters}`;
  }
  const submitTime = new Date(submission.submittedAt).toLocaleString(getLocale(lang));

  const languageRecord: Record<string, string> = {
    cpp: "C++",
    pypy3: "PyPy3",
    java: "Java",
    c: "C",
  };


  return (
    <div className="bg-white w-full shadow-sm border border-slate-200 rounded-2xl p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h2 className="text-2xl font-serif font-bold text-gray-800">
          {dict.submission.submission} #{submission.displayId}
        </h2>
        {canRejudge && (
          <ContestRejudgeButton
            contestId={cid}
            submissionId={submission.id}
            verdict={submission.verdict}
          />
        )}
        <Link
          href={backHref}
          className="text-blue-600 hover:text-blue-800 hover:underline"
        >
          ← {domjudge ? dict.nav.home : dict.submission.backToStatus}
        </Link>
      </div>

      {/* 提交信息卡片 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.user}:
            </span>
            <p className="text-gray-900">
              {submission.user?.displayName ||
                submission.globalUser?.displayName ||
                submission.user?.username ||
                submission.globalUser?.username}
            </p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.problem}:
            </span>
            <p className="text-gray-900">
              <Link
                href={`/contest/${contestId}/problems/${contestProblem?.displayId}`}
                className="text-blue-600 hover:underline"
              >
                {contestProblem?.displayId} - {submission.problem.title}
              </Link>
            </p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.language}:
            </span>
            <p className="text-gray-900">
              {languageRecord[submission.language] || submission.language}
            </p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.submitTime}:
            </span>
            <p className="text-gray-900">{submitTime}</p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.verdict}:
            </span>
            <div className="mt-1">
              <VerdictBadge status={submission.verdict} />
            </div>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.time}:
            </span>
            <p className="text-gray-900">
              {submission.timeUsed !== null ? `${submission.timeUsed} ms` : "-"}
            </p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.memory}:
            </span>
            <p className="text-gray-900">
              {submission.memoryUsed !== null
                ? `${submission.memoryUsed} KB`
                : "-"}
            </p>
          </div>
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.codeLength}:
            </span>
            <p className="text-gray-900">{formatMessage(dict.submission.codeSize, { count: submission.codeLength })}</p>
          </div>
        </div>

        {canViewCode && submission.errorMessage && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-sm">
            <span className="font-bold text-red-600">{dict.submission.errorMessage}</span>
            <pre className="mt-2 text-sm text-red-700 whitespace-pre-wrap">
              {submission.errorMessage}
            </pre>
          </div>
        )}
      </div>

      {/* 代码展示 */}
      {canViewCode ? (
        <CodeViewer code={submission.code} language={submission.language} />
      ) : (
        <p className="text-sm text-gray-500">
          {dict.submission.vpCodeRestricted}
        </p>
      )}
    </div>
  );
}
