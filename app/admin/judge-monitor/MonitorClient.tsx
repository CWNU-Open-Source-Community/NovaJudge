"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";
import { getVerdictLabel } from "@/lib/dictionaries";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowPathIcon,
  ClockIcon,
  QueueListIcon,
  ServerIcon,
  TrophyIcon,
  UsersIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import type {
  MonitorStats,
  MonitorMinuteBucket,
} from "@/lib/monitor";

// 判定结果的展示配色（与 VerdictBadge 风格一致）
const VERDICT_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-100 text-green-700",
  WRONG_ANSWER: "bg-red-100 text-red-700",
  TIME_LIMIT_EXCEEDED: "bg-amber-100 text-amber-700",
  MEMORY_LIMIT_EXCEEDED: "bg-purple-100 text-purple-700",
  RUNTIME_ERROR: "bg-orange-100 text-orange-700",
  COMPILE_ERROR: "bg-yellow-100 text-yellow-700",
  PRESENTATION_ERROR: "bg-pink-100 text-pink-700",
  SYSTEM_ERROR: "bg-gray-200 text-gray-700",
  PENDING: "bg-blue-100 text-blue-700",
  JUDGING: "bg-cyan-100 text-cyan-700",
};

function verdictClass(verdict: string) {
  return VERDICT_COLORS[verdict] ?? "bg-gray-100 text-gray-700";
}

function formatMinute(timestamp: number, localize: boolean) {
  const date = new Date(timestamp);
  if (!localize) return date.toISOString().slice(11, 16);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const subscribeToHydration = () => () => {};

const CHART_W = 640;
const CHART_H = 180;
const CHART_PAD_TOP = 10;
const CHART_PAD_BOTTOM = 26;
const CHART_PAD_X = 2;

function SubmissionsChart({
  minutes,
  localizeTime,
}: {
  minutes: MonitorMinuteBucket[];
  localizeTime: boolean;
}) {
  const { t } = useAdminLocale();
  const plotW = CHART_W - CHART_PAD_X * 2;
  const plotH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const slot = plotW / minutes.length;
  const barW = Math.max(1, slot * 0.7);
  const maxCount = Math.max(1, ...minutes.map((m) => m.count));

  // 每 10 分钟一个 x 轴标签
  const labelIdx = minutes
    .map((_, i) => i)
    .filter((i) => i % 10 === 0);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full min-w-[26rem]"
      role="img"
      aria-label={t("Submissions per minute (last 60 minutes)", "最近 60 分钟每分钟提交量")}
    >
      {/* 顶部分钟刻度线 */}
      <line
        x1={CHART_PAD_X}
        y1={CHART_PAD_TOP}
        x2={CHART_W - CHART_PAD_X}
        y2={CHART_PAD_TOP}
        stroke="#e5e7eb"
        strokeWidth="1"
      />
      {minutes.map((m, i) => {
        const x = CHART_PAD_X + i * slot + (slot - barW) / 2;
        const h = m.count > 0 ? Math.max(2, (m.count / maxCount) * plotH) : 1;
        const y = CHART_PAD_TOP + plotH - h;
        const isPeak = m.count > 0 && m.count === maxCount;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx="1"
            fill={isPeak ? "#2563eb" : m.count > 0 ? "#93c5fd" : "#e5e7eb"}
          >
            <title>
              {t(`${formatMinute(m.timestamp, localizeTime)} — ${m.count} submissions`, `${formatMinute(m.timestamp, localizeTime)} · ${m.count} 条提交`)}
            </title>
          </rect>
        );
      })}
      {labelIdx.map((i) => (
        <text
          key={i}
          x={CHART_PAD_X + i * slot + slot / 2}
          y={CHART_H - 8}
          textAnchor="middle"
          fontSize="9"
          fill="#9ca3af"
        >
          {formatMinute(minutes[i].timestamp, localizeTime)}
        </text>
      ))}
    </svg>
  );
}

export default function MonitorClient({
  initial,
}: {
  initial: MonitorStats;
}) {
  const { t, locale } = useAdminLocale();
  const [data, setData] = useState<MonitorStats>(initial);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // SSR/首次 hydration 使用稳定的 UTC 标签；挂载后再切换为浏览器本地时区，
  // 避免服务器与管理员浏览器时区不同导致 hydration mismatch。
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/monitor", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as MonitorStats;
        if (!stopped) {
          setData(json);
          setLastUpdated(Date.now());
        }
      } catch {
        // 网络抖动时保留上一次数据
      }
    }

    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const { queue, workers, minutes, verdicts } = data;
  const maxPerMinute = Math.max(0, ...minutes.map((m) => m.count));

  const cards = [
    {
      label: t("Queue waiting", "等待评测"),
      value: queue?.waiting ?? 0,
      icon: QueueListIcon,
      color: queue && queue.waiting > 0 ? "text-amber-600" : "text-gray-500",
    },
    {
      label: t("Queue active", "正在评测"),
      value: queue?.active ?? 0,
      icon: ClockIcon,
      color: "text-blue-600",
    },
    {
      label: t("Workers online", "在线判题进程"),
      value: workers.length,
      icon: ServerIcon,
      color: workers.length > 0 ? "text-green-600" : "text-red-600",
    },
    {
      label: t("Active teams (10 min)", "活跃队伍（10 分钟）"),
      value: data.onlineTeams,
      icon: UsersIcon,
      color: "text-orange-600",
    },
    {
      label: t("Submissions (1 h)", "提交量（1 小时）"),
      value: data.submissionsLastHour,
      icon: ChartBarIcon,
      color: "text-green-600",
    },
    {
      label: t("Running contests", "进行中的比赛"),
      value: data.runningContests,
      icon: TrophyIcon,
      color: "text-purple-600",
    },
  ];

  return (
    <div className="space-y-5">
      {/* 指标卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card) => (
          <div
            key={card.label}
            className="admin-card flex flex-wrap items-start gap-2.5 p-3.5 sm:p-4"
          >
            <card.icon className={`w-6 h-6 ${card.color} shrink-0`} />
            <div className="min-w-0">
              <div className="text-xl leading-none font-semibold tabular-nums text-gray-900">
                {card.value.toLocaleString(locale)}
              </div>
              <div className="mt-1 text-xs font-medium text-gray-600">
                {card.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 提交曲线 */}
      <div className="admin-card p-4 sm:p-5">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <ChartBarIcon className="w-5 h-5 text-gray-500" />
            {t("Submissions / Minute (last 60 min)", "每分钟提交量（近 60 分钟）")}
          </h3>
          <span className="text-xs text-gray-400 flex items-center gap-2">
            <span>
              {t("Peak:", "峰值：")} <b className="text-gray-600">{maxPerMinute}{t("/min", "条/分钟")}</b>
            </span>
            <span>
              {lastUpdated === null
                ? t("refreshing…", "正在刷新…")
                : t(`Updated ${new Date(lastUpdated).toLocaleTimeString(locale)}`, `更新于 ${new Date(lastUpdated).toLocaleTimeString(locale)}`)}
            </span>
            <ArrowPathIcon className="size-3.5" aria-hidden="true" />
          </span>
        </div>
        {data.submissionsLastHour === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
            {t("No submissions in the last hour.", "最近一小时暂无提交。")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <SubmissionsChart minutes={minutes} localizeTime={isHydrated} />
          </div>
        )}
      </div>

      {/* 判定结果分布 */}
      <div className="admin-card p-4 sm:p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <QueueListIcon className="w-5 h-5 text-gray-500" />
          {t("Verdict Distribution (last 60 min)", "判题结果分布（近 60 分钟）")}
        </h3>
        {verdicts.length === 0 ? (
          <div className="text-sm text-gray-400">{t("No data.", "暂无数据。")}</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {verdicts.map((v) => (
              <span
                key={v.verdict}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${verdictClass(
                  v.verdict,
                )}`}
              >
                {getVerdictLabel(v.verdict)}
                <span className="opacity-70">{v.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
