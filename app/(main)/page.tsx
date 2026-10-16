import { ContestStatus, ContestType } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { JsonValue } from "@prisma/client/runtime/client";
import Link from "next/link";
import { getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  LockClosedIcon,
  GlobeAltIcon,
  ClockIcon,
  CalendarDaysIcon,
  TrophyIcon,
  HashtagIcon,
} from "@heroicons/react/24/outline";
import { getDictionary } from "@/lib/get-dictionary";
import { hasContestAccess } from "@/lib/contest-access";

export type ContestConfig = {
  medal: {
    mode: "ratio" | "fixed";
    gold: number;
    silver: number;
    bronze: number;
  };
  frozenDuration: number;
  unfreezeDelay: number;
  awards?: {
    enabled: boolean;
    base?: {
      gold?: string;
      silver?: string;
      bronze?: string;
    };
    firstToSolve?: boolean;
    excellenceAward?: boolean;
    excellenceCitation?: string;
    topThree?: boolean;
    topThreeCitations?: {
      champion?: string;
      runnerUp?: string;
      third?: string;
    };
    custom: {
      id: string;
      citation: string;
      teamIds: string[];
    }[];
  };
};

export interface Contest {
  id: number;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  type: ContestType;
  password: string | null;
  status: ContestStatus;
  config: ContestConfig | null | JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

// 辅助函数：格式化持续时间
function formatDuration(start: Date, end: Date) {
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// 辅助函数：格式化日期
function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// 提取状态徽章组件，以便复用
function StatusBadge({ status }: { status: ContestStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
        status === ContestStatus.RUNNING
          ? "bg-green-50 text-green-700 border-green-200"
          : status === ContestStatus.ENDED
            ? "bg-gray-100 text-gray-600 border-gray-200"
            : "bg-blue-50 text-blue-700 border-blue-200"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === ContestStatus.RUNNING
            ? "bg-green-500 animate-pulse"
            : status === ContestStatus.ENDED
              ? "bg-gray-400"
              : "bg-blue-500"
        }`}
      />
      {status}
    </span>
  );
}

export default async function ContestList() {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    if ((currentUser as UserJwtPayload).contestId) {
      redirect(`/contest/${(currentUser as UserJwtPayload).contestId}`);
    }
  }

  const contests = await prisma.contest.findMany({
    where: { visible: true },
    orderBy: { id: "desc" },
  });
  const access = new Map(await Promise.all(contests.map(async (contest) =>
    [contest.id, contest.type === ContestType.PUBLIC || await hasContestAccess(contest.id)] as const,
  )));

  const dict = await getDictionary();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10">
      {/* 头部区域 */}
      <div className="flex items-center gap-3 mb-6 md:mb-8">
        <div className="p-2 bg-blue-600 rounded-lg shadow-md text-white">
          <TrophyIcon className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 tracking-tight">
            {dict.contestList.title}
          </h1>
          <p className="text-gray-500 text-xs md:text-sm mt-0.5">
            {dict.contestList.subtitle}
          </p>
        </div>
      </div>

      {contests.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
          <TrophyIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-lg font-medium">
            {dict.contestList.noContestsFound}
          </p>
          <p>暂无公开比赛，请稍后再来看看。</p>
        </div>
      ) : (
        <>
          {/* --- Mobile View (Cards) --- */}
          <div className="grid gap-4 md:hidden">
            {contests.map((contest) => {
              if (!access.get(contest.id)) {
                return (
                  <Link key={contest.id} href={`/contest/${contest.id}/access`} className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 font-bold text-gray-900">
                      <LockClosedIcon className="h-5 w-5 text-orange-500" />
                      {dict.contestList.private} #{contest.id}
                    </div>
                    <p className="mt-2 text-sm text-gray-500">输入比赛密码后查看</p>
                  </Link>
                );
              }
              const config = contest.config as ContestConfig;
              const frozenText = config?.frozenDuration
                ? `Last ${config.frozenDuration}m frozen`
                : null;

              return (
                <Link
                  key={contest.id}
                  href={`/contest/${contest.id}`}
                  className="block bg-white rounded-xl p-5 shadow-sm border border-gray-200 "
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                      <HashtagIcon className="w-3 h-3" />
                      {contest.id}
                    </div>
                    {contest.type === ContestType.PRIVATE ? (
                      <LockClosedIcon className="w-4 h-4 text-orange-400" />
                    ) : (
                      <GlobeAltIcon className="w-4 h-4 text-blue-400" />
                    )}
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 font-serif mb-3 leading-snug">
                    {contest.title}
                  </h3>

                  <div className="flex flex-wrap gap-2 mb-4">
                    <StatusBadge status={contest.status} />
                    {frozenText && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-100">
                        ❄️ {frozenText}
                      </span>
                    )}
                  </div>

                  <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-4 text-sm text-gray-600">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase text-gray-400 font-bold">
                        {dict.contestList.startTime}
                      </span>
                      <div className="flex items-center gap-1.5 font-medium">
                        <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
                        {formatDate(contest.startTime)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase text-gray-400 font-bold">
                        {dict.contestList.duration}
                      </span>
                      <div className="flex items-center gap-1.5 font-medium">
                        <ClockIcon className="w-4 h-4 text-gray-400" />
                        {formatDuration(contest.startTime, contest.endTime)}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* --- Desktop View (Table) --- */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                    <th className="px-6 py-4 w-20 text-center">ID</th>
                    <th className="px-6 py-4 w-1/3">
                      {dict.contestList.title}
                    </th>
                    <th className="px-6 py-4">{dict.contestList.status}</th>
                    <th className="px-6 py-4">{dict.contestList.type}</th>
                    <th className="px-6 py-4">{dict.contestList.timeline}</th>
                    <th className="px-6 py-4 text-center">
                      {dict.contestList.duration}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contests.map((contest) => {
                    if (!access.get(contest.id)) {
                      return (
                        <tr key={contest.id} className="hover:bg-slate-50">
                          <td className="px-6 py-5 text-center font-mono text-sm text-gray-400">#{contest.id}</td>
                          <td colSpan={5} className="px-6 py-5">
                            <Link href={`/contest/${contest.id}/access`} className="flex items-center gap-2 font-bold text-gray-800 hover:text-blue-600">
                              <LockClosedIcon className="h-5 w-5 text-orange-500" />
                              {dict.contestList.private} · 输入比赛密码后查看
                            </Link>
                          </td>
                        </tr>
                      );
                    }
                    const config = contest.config as ContestConfig;
                    const frozenText = config?.frozenDuration
                      ? `Last ${config.frozenDuration}m frozen`
                      : null;

                    return (
                      <tr
                        key={contest.id}
                        className="group hover:bg-slate-50 transition-colors duration-200"
                      >
                        <td className="px-6 py-5 text-gray-400 font-mono text-center text-sm group-hover:text-gray-600">
                          #{contest.id}
                        </td>

                        <td className="px-6 py-5">
                          <Link
                            href={`/contest/${contest.id}`}
                            className="block"
                          >
                            <span className="text-lg font-bold text-gray-800 group-hover:text-blue-600 transition-colors font-serif">
                              {contest.title}
                            </span>
                            {frozenText && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-100">
                                  ❄️ {frozenText}
                                </span>
                              </div>
                            )}
                          </Link>
                        </td>

                        <td className="px-6 py-5">
                          <StatusBadge status={contest.status} />
                        </td>

                        <td className="px-6 py-5">
                          {contest.type === ContestType.PRIVATE ? (
                            <div className="flex items-center gap-1.5 text-gray-600 text-sm font-medium">
                              <LockClosedIcon className="w-4 h-4 text-orange-500" />
                              <span>{dict.contestList.private}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-gray-600 text-sm font-medium">
                              <GlobeAltIcon className="w-4 h-4 text-blue-500" />
                              <span>{dict.contestList.public}</span>
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex flex-col text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
                              <span className="font-medium text-gray-900">
                                {formatDate(contest.startTime)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 pl-6 text-xs text-gray-500">
                              to {formatDate(contest.endTime)}
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-5 text-center">
                          <div className="inline-flex items-center gap-1.5 text-sm text-gray-600 bg-gray-100/80 px-2 py-1 rounded-md">
                            <ClockIcon className="w-4 h-4 text-gray-500" />
                            <span className="font-mono font-medium">
                              {formatDuration(
                                contest.startTime,
                                contest.endTime,
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
