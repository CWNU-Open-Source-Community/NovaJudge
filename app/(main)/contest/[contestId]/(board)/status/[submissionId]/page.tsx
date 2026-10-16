import { requireContestAccess } from "@/lib/contest-access";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getCurrentSuper,
  verifyAuth,
} from "@/lib/auth";
import { cookies } from "next/headers";
import { ContestRole, ContestStatus } from "@/lib/generated/prisma/client";
import VerdictBadge from "@/components/VerdictBadge";
import Link from "next/link";
import CodeViewer from "./CodeViewer";
import { ContestConfig } from "@/app/(main)/page";
import { getDictionary } from "@/lib/get-dictionary";
import { getRunningVirtualParticipation } from "@/lib/virtual-participation";

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
      select: { status: true, config: true, endTime: true, type: true },
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

  // 2. 获取当前用户信息
  const cookieStore = await cookies();
  const token = cookieStore.get("user_token")?.value;
  const payload = token ? await verifyAuth(token).catch(() => null) : null;

  // 3. 权限校验逻辑
  const isContestEnded = contestInfo.status === ContestStatus.ENDED;
  const isGlobalAdmin = !!globalUser?.isGlobalAdmin;
  const runningVp =
    globalUser?.userId && !isGlobalAdmin
      ? await getRunningVirtualParticipation(cid, String(globalUser.userId))
      : null;

  const config = contestInfo.config as ContestConfig;
  const freezeTime =
    contestInfo.endTime.getTime() - config.frozenDuration! * 60 * 1000;
  const isFrozen =
    config.frozenDuration !== 0 &&
    (freezeTime ? new Date().getTime() >= freezeTime : false);

  if (payload?.userId || globalUser?.userId || isGlobalAdmin) {
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

      if (!currentUser || currentUser.contestId !== cid) {
        return notFound();
      }
    }

    // 检查是否为当前比赛的用户

    // 检查权限逻辑：
    // 1. 提交者总能看自己的
    // 2. 管理员/评委总能看所有的
    // 3. 普通用户只能在比赛结束后看其他人的

    const isOwner =
      (!!currentUser?.id && submission.user?.id === currentUser.id) ||
      (!!globalUser?.userId && submission.globalUser?.id === globalUser.userId &&
        (!runningVp || submission.virtualParticipationId === runningVp.id));

    const isAdmin =
      isGlobalAdmin ||
      currentUser?.role === ContestRole.ADMIN ||
      currentUser?.role === ContestRole.JUDGE;
    const isPublicOfficialSubmission =
      isContestEnded && !isFrozen && submission.virtualParticipationId === null;
    const hasPermission =
      isOwner || isAdmin || (!isOwner && isPublicOfficialSubmission);

    if (!hasPermission) {
      return notFound();
    }
  } else {
    // 未登录用户：只能在比赛结束后 并且 未封榜 查看
    if (!isContestEnded || isFrozen) {
      return notFound();
    }
  }

  const contestProblem = await prisma.contestProblem.findFirst({
    where: {
      contestId: cid,
      problemId: submission.problemId,
    },
    select: {
      displayId: true,
    },
  });

  const submitTime = new Date(submission.submittedAt).toLocaleString("zh-CN");

  const languageRecord: Record<string, string> = {
    cpp: "C++",
    pypy3: "PyPy3",
    java: "Java",
    c: "C",
  };

  const dict = await getDictionary();

  return (
    <div className="bg-white w-full shadow-sm border border-gray-100 rounded-sm p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-serif font-bold text-gray-800">
          {dict.submission.submission} #{submission.displayId}
        </h2>
        <Link
          href={`/contest/${contestId}/status`}
          className="text-blue-600 hover:text-blue-800 hover:underline"
        >
          ← Back to Status
        </Link>
      </div>

      {/* 提交信息卡片 */}
      <div className="bg-gray-50 border border-gray-200 rounded-sm p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="font-bold text-gray-600">
              {dict.submission.user}:
            </span>
            <p className="text-gray-900">
              {submission.user?.displayName ||
                submission.globalUser?.displayName ||
                submission.user?.username}
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
            <p className="text-gray-900">{submission.codeLength} bytes</p>
          </div>
        </div>

        {submission.errorMessage && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-sm">
            <span className="font-bold text-red-600">Error Message:</span>
            <pre className="mt-2 text-sm text-red-700 whitespace-pre-wrap">
              {submission.errorMessage}
            </pre>
          </div>
        )}
      </div>

      {/* 代码展示 */}
      <CodeViewer code={submission.code} language={submission.language} />
    </div>
  );
}
