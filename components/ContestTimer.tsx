"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { ClockIcon } from "@heroicons/react/24/outline";
import DomjudgeIcon from "./contest/DomjudgeIcon";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage } from "@/lib/dictionaries";

interface Props {
  startTime: string | Date;
  endTime: string | Date;
  frozenDuration?: number;
  endedLabel?: string;
  domjudgeState?: { started: boolean; ended: boolean };
}

export default function ContestTimer({
  startTime,
  endTime,
  frozenDuration = 0,
  endedLabel,
  domjudgeState,
}: Props) {
  const { dict } = useLanguage();
  const router = useRouter();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const duration = end - start;
  const refreshAt = domjudgeState && !domjudgeState.ended
    ? (domjudgeState.started ? end : start) : Infinity;

  // 【优化】初始值为 null，代表未挂载/服务端状态
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // 客户端挂载后，立即获取一次时间
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());

    // 启动定时器
    let nextRefresh = refreshAt;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= nextRefresh) {
        // The worker may publish the new contest status shortly after the clock boundary.
        nextRefresh = time + 30_000;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [refreshAt, router]);

  // 计算封榜线的百分比位置
  let frozenPercentage = 0;
  if (frozenDuration > 0) {
    const frozenTime = end - frozenDuration * 60 * 1000; // 结束时间 - 分钟数
    if (frozenTime > start && frozenTime < end) {
      frozenPercentage = ((frozenTime - start) / duration) * 100;
    }
  }

  if (domjudgeState) {
    const ended = domjudgeState.ended || (now !== null && now >= end);
    const upcoming = !ended && !domjudgeState.started;
    const seconds = now === null ? 0 : Math.max(0, Math.ceil(((upcoming ? start : end) - now) / 1000));
    const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(part => String(part).padStart(2, "0")).join(":");
    const label = ended ? "contest over" : upcoming ? "starts in" : "time left";
    const percent = now !== null && end > start ? Math.max(0, Math.min(100, (now - start) * 100 / duration)) : 0;
    return (
      <div className="dj-clock" title={label}>
        <DomjudgeIcon icon={faClock} />
        {upcoming && <span>{label}</span>}
        <span role="timer" aria-label={label}>{ended ? label : now === null ? "––:––:––" : time}</span>
        {now !== null && !upcoming && !ended && (
          <div className="dj-progress" role="progressbar" aria-label={dict.contest.elapsed}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}>
            <div style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    );
  }

  const elapsed = Math.max(0, (now ?? start) - start);
  const progress = duration > 0 ? Math.min(100, elapsed * 100 / duration) : 0;
  const running = now !== null && now >= start && now < end;
  const freezeLabel = formatMessage(dict.contest.freezesBeforeEnd, { minutes: frozenDuration });

  let clock;
  if (now === null) {
    clock = <div className="h-6 w-32 bg-gray-100 animate-pulse rounded" />;
  } else if (now < start) {
    const diff = start - now;
    clock = <div className="flex items-center gap-2 text-blue-600 font-mono font-bold bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">
      <ClockIcon className="w-5 h-5" />
      <span>{formatMessage(dict.contest.startsIn, {
        hours: Math.floor(diff / 3600000), minutes: Math.floor(diff / 60000) % 60, seconds: Math.floor(diff / 1000) % 60,
      })}</span>
    </div>;
  } else if (!running) {
    clock = <div className="flex items-center gap-2 text-gray-500 font-bold bg-gray-100 px-3 py-1.5 rounded-full border border-gray-200">
      {endedLabel ?? dict.contest.ENDED}
    </div>;
  } else {
    const remaining = end - now;
    const elapsedMinutes = String(Math.floor(elapsed / 60000) % 60).padStart(2, "0");
    const minutes = String(Math.floor(remaining / 60000) % 60).padStart(2, "0");
    const seconds = String(Math.floor(remaining / 1000) % 60).padStart(2, "0");
    clock = <div className="flex justify-between text-base font-medium text-gray-600 mb-1">
      <span>{dict.contest.elapsed} {Math.floor(elapsed / 3600000)}:{elapsedMinutes}</span>
      <span className="text-red-600 font-mono">-{Math.floor(remaining / 3600000)}:{minutes}:{seconds}</span>
    </div>;
  }

  return <div className="w-full">
    <div className="contest-timer-label">{clock}</div>
    <div role="progressbar" aria-label={dict.contest.elapsed} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={now === null ? undefined : Math.floor(progress)}
      className={`contest-timer-track relative h-3 w-full overflow-hidden rounded-full border border-gray-300 bg-gray-200 ${running ? "" : "hidden"}`}>
      <div className="h-full bg-linear-to-r from-green-500 to-green-600 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
        style={{ width: `${progress}%` }} />
      {frozenPercentage > 0 && <div title={freezeLabel} className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${frozenPercentage}%` }} />}
    </div>
  </div>;
}
