"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { ClockIcon } from "@heroicons/react/24/outline";
import DomjudgeIcon from "./contest/DomjudgeIcon";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, getLocale } from "@/lib/dictionaries";

interface Props {
  startTime: string | Date;
  endTime: string | Date;
  frozenDuration?: number;
  endedLabel?: string;
  domjudgeState?: { started: boolean; ended: boolean };
}

const pad = (value: number) => String(value).padStart(2, "0");

function clockText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

const tones = {
  normal: { clock: "text-slate-900", fill: "from-blue-500 to-indigo-500" },
  frozen: { clock: "text-sky-600", fill: "from-sky-400 to-blue-500" },
  warning: { clock: "text-amber-600", fill: "from-amber-400 to-orange-500" },
  critical: { clock: "text-red-600 motion-safe:animate-pulse", fill: "from-red-500 to-rose-500" },
};

export default function ContestTimer({
  startTime,
  endTime,
  frozenDuration = 0,
  endedLabel,
  domjudgeState,
}: Props) {
  const { dict, lang } = useLanguage();
  const router = useRouter();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const duration = end - start;
  const refreshAt = domjudgeState && !domjudgeState.ended
    ? (domjudgeState.started ? end : start) : Infinity;

  // null until mounted, so the server render never shows a stale clock.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());

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

  // Position of the freeze boundary on the progress bar.
  const freezeAt = frozenDuration > 0 ? end - frozenDuration * 60 * 1000 : null;
  const frozenPercentage = freezeAt !== null && freezeAt > start && freezeAt < end
    ? ((freezeAt - start) / duration) * 100 : 0;

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

  const locale = getLocale(lang);
  // Contests spanning more than a day also show the date on the time scale.
  const scaleFormat: Intl.DateTimeFormatOptions = duration > 20 * 3600 * 1000
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  const formatClock = (time: number) => new Date(time).toLocaleString(locale, scaleFormat);
  const elapsed = Math.max(0, (now ?? start) - start);
  const progress = duration > 0 ? Math.min(100, elapsed * 100 / duration) : 0;
  const running = now !== null && now >= start && now < end;
  const remaining = now === null ? 0 : end - now;
  const frozenPhase = running && freezeAt !== null && (now ?? 0) >= freezeAt;
  const tone = tones[
    !running ? "normal"
      : remaining <= 5 * 60 * 1000 ? "critical"
        : remaining <= 30 * 60 * 1000 ? "warning"
          : frozenPhase ? "frozen" : "normal"
  ];
  const freezeLabel = formatMessage(dict.contest.freezesBeforeEnd, { minutes: frozenDuration });

  let clock;
  if (now === null) {
    clock = <div className="h-11 w-52 animate-pulse rounded-lg bg-slate-100" />;
  } else if (now < start) {
    clock = (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 ring-inset">
          <ClockIcon className="size-4" aria-hidden="true" />
          {dict.domjudge.startsIn}
        </span>
        <span role="timer" className="font-mono text-3xl font-bold tabular-nums text-slate-900">
          {clockText(start - now)}
        </span>
      </div>
    );
  } else if (!running) {
    clock = (
      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 ring-inset">
        <span className="size-2 rounded-full bg-slate-400" aria-hidden="true" />
        {endedLabel ?? dict.contest.ENDED}
      </span>
    );
  } else {
    clock = (
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {dict.domjudge.timeLeft}
          </div>
          <div role="timer" className={`font-mono text-4xl font-bold leading-tight tabular-nums ${tone.clock}`}>
            {clockText(remaining)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          {frozenPhase && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 ring-inset">
              <span aria-hidden="true">❄</span>
              {dict.contestList.frozen}
            </span>
          )}
          <span>
            {dict.contest.elapsed}{" "}
            <span className="font-mono font-semibold tabular-nums text-slate-700">{clockText(elapsed)}</span>
          </span>
          <span className="font-mono font-semibold tabular-nums text-slate-700">{Math.floor(progress)}%</span>
        </div>
      </div>
    );
  }

  return <div className="w-full">
    <div className="contest-timer-label">{clock}</div>
    <div role="progressbar" aria-label={dict.contest.elapsed} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={now === null ? undefined : Math.floor(progress)}
      className={`contest-timer-track relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 ring-inset ${running ? "" : "hidden"}`}>
      {frozenPercentage > 0 && (
        <div title={freezeLabel} className="nova-frozen-zone absolute inset-y-0 right-0"
          style={{ left: `${frozenPercentage}%` }} />
      )}
      <div className={`relative h-full rounded-full bg-linear-to-r ${tone.fill} transition-[width] duration-1000 ease-linear motion-reduce:transition-none`}
        style={{ width: `${progress}%` }} />
    </div>
    {running && (
      <div className="contest-timer-scale relative mt-1.5 h-4 text-[11px] tabular-nums text-slate-500">
        <span className="absolute left-0">{formatClock(start)}</span>
        {frozenPercentage > 12 && frozenPercentage < 88 && freezeAt !== null && (
          <span title={freezeLabel} className="absolute -translate-x-1/2 whitespace-nowrap font-medium text-sky-600"
            style={{ left: `${frozenPercentage}%` }}>
            ❄ {formatClock(freezeAt)}
          </span>
        )}
        <span className="absolute right-0">
          {frozenPercentage >= 88 && <span title={freezeLabel} className="mr-1 text-sky-600">❄</span>}
          {formatClock(end)}
        </span>
      </div>
    )}
  </div>;
}
