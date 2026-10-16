import { requireContestAccess } from "@/lib/contest-access";
// app/contest/[contestId]/page.tsx

import { getCurrentSuper, verifyAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { loginContestUser, startContestVirtualParticipation } from "./actions";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  ClockIcon,
  GlobeAltIcon,
  LockClosedIcon,
  PlayIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { ContestStatus, ContestType } from "@/lib/generated/prisma/client";
import { getDictionary } from "@/lib/get-dictionary";
import { Metadata } from "next";
import Link from "next/link";
import {
  getLatestVirtualParticipation,
  isVpEnabled,
} from "@/lib/virtual-participation";

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
    title: `${contest.title}`,
  };
}
interface Props {
  params: Promise<{
    contestId: string;
  }>;
}

interface PageProps extends Props {
  searchParams: Promise<{
    error?: string;
    autoLogin?: string;
  }>;
}

function getContestLoginErrorMessage(error?: string) {
  switch (error) {
    case "missing_credentials":
      return "请输入用户名和密码。";
    case "invalid_credentials":
      return "用户名或密码错误，请重新输入。";
    case "proctoring_required":
      return "该账号已绑定监考，请通过监考客户端登录并访问本场比赛。";
    default:
      return null;
  }
}

export default async function ContestLogin({
  params,
  searchParams,
}: PageProps) {
  const contestId = (await params).contestId;
  const { error, autoLogin } = await searchParams;
  const id = Number(contestId);
  await requireContestAccess(id);
  const loginErrorMessage = getContestLoginErrorMessage(error);

  const contest = await prisma.contest.findUnique({
    where: { id },
  });

  if (!contest) notFound();

  // 检查是否已登录
  const cookieStore = await cookies();
  const user_token = cookieStore.get("user_token")?.value;
  const globalSession = await getCurrentSuper();
  let user;
  let super_admin;
  let glabel_user;
  if (user_token) {
    const payload = await verifyAuth(user_token).catch(() => null);
    if (payload?.userId && payload.contestId === id) {
      user = await prisma.user.findFirst({
        where: { id: payload.userId, contestId: id },
      });
    }
  }
  if (globalSession) {
    if (globalSession.isGlobalAdmin) {
      super_admin = globalSession.username;
    } else {
      glabel_user = globalSession;
    }
  }

  if (!user && !super_admin && !error && autoLogin !== "miss") {
    redirect(`/api/contests/${id}/auto-login`);
  }

  const now = new Date();
  const contestEnded =
    contest.status === ContestStatus.ENDED || now >= contest.endTime;
  const canUseVp =
    contestEnded && globalSession?.userId && isVpEnabled(contest.config);
  const latestVp = canUseVp
    ? await getLatestVirtualParticipation(id, String(globalSession.userId))
    : null;
  const latestVpRunning =
    latestVp?.status === "RUNNING" &&
    latestVp.startedAt <= now &&
    latestVp.endedAt >= now;

  const dict = await getDictionary();
  const latestVpAttemptText = latestVp
    ? dict.virtualParticipation.attempt.replace(
        "{attempt}",
        String(latestVp.attemptNo),
      )
    : "";
  const formatVpTime = (date: Date) =>
    date.toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="flex flex-col max-w-7xl mx-auto md:flex-row gap-12 mt-10">
      {/* 左侧：显示当前 Contest ID 对应的比赛信息 */}
      <div className="flex-1 min-w-3xl hidden md:block">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="p-6 md:p-8 border-b border-gray-100 bg-linear-to-b from-gray-50 to-white">
            <div className="flex gap-5">
              <div className="p-3.5 bg-blue-600 rounded-xl shadow-md text-white h-fit shrink-0">
                <TrophyIcon className="w-8 h-8" />
              </div>
              <div className="flex-1 py-1">
                <div className="flex flex-wrap items-center gap-3 mb-2.5">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200 font-mono">
                    #{contest.id}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                      contest.status === ContestStatus.RUNNING
                        ? "bg-green-50 text-green-700 border-green-200"
                        : contest.status === ContestStatus.ENDED
                          ? "bg-gray-100 text-gray-600 border-gray-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        contest.status === ContestStatus.RUNNING
                          ? "bg-green-500 animate-pulse"
                          : contest.status === ContestStatus.ENDED
                            ? "bg-gray-400"
                            : "bg-blue-500"
                      }`}
                    />
                    {contest.status}
                  </span>
                </div>
                <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 leading-snug">
                  {contest.title}
                </h1>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 border-b border-gray-100 divide-y md:divide-y-0 md:divide-x divide-gray-100 bg-gray-50/30">
            <div className="p-5 md:p-6 flex items-start gap-4 hover:bg-white transition-colors">
              <CalendarDaysIcon className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  {dict.contestList.startTime}
                </p>
                <p className="text-sm font-medium text-gray-900 font-mono">
                  {contest.startTime.toLocaleString("zh-CN", {
                    hour12: false,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              </div>
            </div>

            <div className="p-5 md:p-6 flex items-start gap-4 hover:bg-white transition-colors">
              {contest.type === ContestType.PRIVATE ? (
                <LockClosedIcon className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              ) : (
                <GlobeAltIcon className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  {dict.contestList.type}
                </p>
                <p className="text-sm font-medium text-gray-900">
                  {contest.type === ContestType.PRIVATE
                    ? dict.contestList.private
                    : dict.contestList.public}
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          {contest.description && (
            <div className="p-6 md:p-8">
              <h3 className="text-sm font-bold text-gray-900 mb-5 flex items-center gap-2 uppercase tracking-wide">
                <span className="w-1 h-4 bg-blue-600 rounded-full"></span>
                {dict.contestList.information}
              </h3>
              <article className="prose prose-sm md:prose-base max-w-none text-gray-600 prose-headings:font-bold prose-headings:text-gray-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200 prose-pre:text-gray-800">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {contest.description}
                </ReactMarkdown>
              </article>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：登录框 */}
      <div className="w-full min-h-40 md:w-100">
        {!user && !globalSession ? (
          <div className="bg-white p-8 shadow-sm border border-gray-100 rounded-sm">
            <h2 className="text-2xl font-serif font-bold text-gray-900 mb-6 border-b pb-4">
              Sign In
            </h2>
            {loginErrorMessage && (
              <div className="mb-5 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {loginErrorMessage}
              </div>
            )}
            <form
              action={async (fromData: FormData) => {
                "use server";
                await loginContestUser(id, fromData);
              }}
              className="space-y-5"
            >
              <div>
                <label className="block text-sm font-bold text-gray-600 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="Username"
                  defaultValue=""
                  name="username"
                  className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-600 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="Password"
                  defaultValue=""
                  name="password"
                  className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                Signing in to Contest{" "}
                <span className="font-bold text-gray-800">{contestId}</span>
              </p>
              <button
                type="submit"
                className="w-full text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-sm text-sm px-5 py-3 shadow-md cursor-pointer"
              >
                Sign In
              </button>
            </form>
          </div>
        ) : super_admin ? (
          <div className="bg-linear-to-br from-purple-50 to-indigo-50 p-8 shadow-lg border border-purple-100 rounded-lg">
            <div className="text-center mb-6">
              <div className="inline-block p-3 bg-purple-100 rounded-full mb-4">
                <svg
                  className="w-12 h-12 text-purple-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                超级管理员
              </h2>
              <div className="w-16 h-1 bg-purple-400 mx-auto mb-4"></div>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <div className="flex items-center justify-center space-x-3">
                <div className="w-10 h-10 bg-linear-to-br from-purple-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  {super_admin?.charAt(0).toUpperCase()}
                </div>
                <div className="text-xl font-semibold text-gray-800">
                  {super_admin}
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="text-center text-sm text-gray-500">
                  拥有完全访问权限
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 shadow-lg border border-blue-100 rounded-lg">
            <div className="text-center mb-6">
              <div className="inline-block p-3 bg-blue-100 rounded-full mb-4">
                <svg
                  className="w-12 h-12 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                参赛信息
              </h2>
              <div className="w-16 h-1 bg-blue-400 mx-auto mb-4"></div>
            </div>

            <div className="space-y-4">
              {/* 队伍名称 */}
              <div className="bg-linear-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-start">
                  <div className="shrink-0">
                    <svg
                      className="w-5 h-5 text-blue-600 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      队伍名称
                    </p>
                    <p className="text-base font-bold text-gray-900">
                      {user?.displayName ||
                        glabel_user?.displayName ||
                        "未设置"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 队员信息 */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start">
                  <div className="shrink-0">
                    <svg
                      className="w-5 h-5 text-gray-600 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      队员
                    </p>
                    <p className="text-sm text-gray-800">
                      {user?.members || glabel_user?.displayName || "未设置"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 学校信息 */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start">
                  <div className="shrink-0">
                    <svg
                      className="w-5 h-5 text-gray-600 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      组织
                    </p>
                    <p className="text-sm text-gray-800">
                      {user?.school || "未设置"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 座位和角色 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="text-center">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      座位号
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {user?.seat || "-"}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="text-center">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      角色
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {user?.role || glabel_user?.role || "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 教练信息 */}
              {user?.coach && (
                <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                  <div className="flex items-start">
                    <div className="shrink-0">
                      <svg
                        className="w-5 h-5 text-amber-600 mt-0.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                        指导教练
                      </p>
                      <p className="text-sm font-medium text-amber-900">
                        {user.coach}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {canUseVp && (
              <section className="mt-6 overflow-hidden rounded-lg border border-blue-200 bg-linear-to-br from-blue-50 via-white to-indigo-50 shadow-sm">
                <div className="border-b border-blue-100 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                      <ClockIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-blue-950">
                          {dict.virtualParticipation.title}
                        </h3>
                        {latestVp && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              latestVpRunning
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-gray-200 bg-gray-50 text-gray-600"
                            }`}
                          >
                            {latestVpRunning
                              ? dict.virtualParticipation.statusRunning
                              : dict.virtualParticipation.statusFinished}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-medium text-blue-800">
                        {dict.virtualParticipation.subtitle}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-blue-700">
                    {dict.virtualParticipation.description}
                  </p>
                </div>

                {latestVp && (
                  <div className="grid gap-3 border-b border-blue-100 bg-white/75 px-5 py-4 text-xs text-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-gray-500">
                        {dict.virtualParticipation.latestAttempt}
                      </span>
                      <span className="font-mono font-semibold text-gray-900">
                        {latestVpAttemptText}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
                        <p className="font-semibold text-blue-700">
                          {dict.virtualParticipation.start}
                        </p>
                        <p className="mt-1 font-mono text-gray-900">
                          {formatVpTime(latestVp.startedAt)}
                        </p>
                      </div>
                      <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
                        <p className="font-semibold text-blue-700">
                          {dict.virtualParticipation.end}
                        </p>
                        <p className="mt-1 font-mono text-gray-900">
                          {formatVpTime(latestVp.endedAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 px-5 py-4">
                  {latestVpRunning && (
                    <Link
                      href={`/contest/${contest.id}/problems`}
                      className="inline-flex items-center gap-2 rounded-sm bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-green-700"
                    >
                      <ArrowRightIcon className="h-4 w-4" />
                      {dict.virtualParticipation.continueButton}
                    </Link>
                  )}
                  <form
                    action={async () => {
                      "use server";
                      await startContestVirtualParticipation(contest.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 rounded-sm bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-800"
                    >
                      {latestVp ? (
                        <ArrowPathIcon className="h-4 w-4" />
                      ) : (
                        <PlayIcon className="h-4 w-4" />
                      )}
                      {latestVp
                        ? dict.virtualParticipation.restartButton
                        : dict.virtualParticipation.startButton}
                    </button>
                  </form>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
