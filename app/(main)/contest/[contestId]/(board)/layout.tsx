import { requireContestAccess } from "@/lib/contest-access";
import { getDictionary, getLanguage } from "@/lib/get-dictionary";
import { formatMessage, getLocale } from "@/lib/dictionaries";
import { Contest, ContestConfig } from "@/app/(main)/page";
import ContestNoticeSniffer from "@/components/ContestNoticeSniffer";
import ContestTimer from "@/components/ContestTimer";
import BalloonCelebration from "@/components/contest/BalloonCelebration";
import { getCurrentSuper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLatestVirtualParticipation } from "@/lib/virtual-participation";
import { scoreboardFreezeTime } from "@/lib/contest-team-standings";

interface Props {
  children: React.ReactNode;
  params: Promise<{
    contestId: string;
  }>;
}

const chip = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset";

export default async function ContestLayout({ children, params }: Props) {
  const { contestId } = await params;
  await requireContestAccess(Number(contestId));

  const contest: Contest | null = await prisma.contest.findUnique({
    where: { id: Number(contestId) },
  });

  const [dict, lang] = await Promise.all([getDictionary(), getLanguage()]);
  if (!contest) return <div>{dict.contestList.notFound}</div>;
  const frozenDuration = Number(
    (contest.config as ContestConfig)?.frozenDuration || 0,
  );
  const globalUser = await getCurrentSuper();
  const latestVp = globalUser?.userId
    ? await getLatestVirtualParticipation(Number(contestId), String(globalUser.userId))
    : null;
  const now = new Date();
  const isRunningVp =
    latestVp?.status === "RUNNING" &&
    latestVp.startedAt <= now &&
    latestVp.endedAt >= now;
  const timerStartTime = isRunningVp ? latestVp.startedAt : contest.startTime;
  const timerEndTime = isRunningVp ? latestVp.endedAt : contest.endTime;
  const clockFormat = new Intl.DateTimeFormat(getLocale(lang), { dateStyle: "short", timeStyle: "short" });
  let boardStatus;
  if (!isRunningVp && contest.status === "PENDING") {
    boardStatus = `${dict.contestList.startTime} ${clockFormat.format(contest.startTime)}`;
  } else if (!isRunningVp && (contest.status === "ENDED" || now >= contest.endTime)) {
    const frozen = +now >= scoreboardFreezeTime(contest.endTime, frozenDuration);
    boardStatus = frozen ? dict.rank.awaitingResults : dict.rank.finalStandings;
  } else {
    const status = isRunningVp ? dict.contest.vpRunning : dict.contest[contest.status];
    boardStatus = `${status} · ${dict.contestList.endTime} ${clockFormat.format(timerEndTime)}`;
  }

  const isLive = isRunningVp || (contest.status === "RUNNING" && now < contest.endTime);
  const isFrozenNow =
    !isRunningVp &&
    isLive &&
    frozenDuration > 0 &&
    +now >= scoreboardFreezeTime(contest.endTime, frozenDuration);
  const statusTone = isLive
    ? { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500 motion-safe:animate-pulse" }
    : contest.status === "PENDING"
      ? { chip: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" }
      : { chip: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" };
  const timeFormat: Intl.DateTimeFormatOptions = {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };

  return (
    <div className="contest-board w-full overflow-x-hidden print:bg-white">
      <ContestNoticeSniffer contestId={Number(contestId)} />
      <BalloonCelebration />
      <div className="contest-board-inner w-full max-w-7xl mx-auto px-4 py-6 space-y-6 print:max-w-none print:px-0 print:py-0 print:space-y-0 print:bg-white">
        <div className="contest-overview relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 print:hidden">
          <div aria-hidden="true" className="contest-overview-accent pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-blue-500 via-indigo-500 to-sky-400" />
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div className="w-full min-w-0 md:w-auto">
              <div className="contest-overview-meta mb-2.5 flex flex-wrap items-center gap-2 text-xs">
                <span className={`${chip} ${statusTone.chip}`}>
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${statusTone.dot}`} />
                  {isRunningVp ? dict.contest.vpRunning : dict.contest[contest.status]}
                </span>
                {isFrozenNow && (
                  <span className={`${chip} bg-sky-50 text-sky-700 ring-sky-200`}>
                    <span aria-hidden="true">❄</span>
                    {dict.contestList.frozen}
                  </span>
                )}
                <span className={`${chip} bg-slate-50 font-mono text-slate-600 ring-slate-200`}>
                  <span className="sr-only">{dict.common.id} </span>#{contest.id}
                </span>
                <span className={`${chip} ${contest.type === "PRIVATE" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                  {contest.type === "PRIVATE" ? dict.contestList.private : dict.contestList.public}
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 wrap-break-word md:text-3xl">
                {contest.title}
              </h1>
              <p className="rank-contest-status hidden">{boardStatus}</p>
            </div>

            <dl className="contest-overview-deadline grid w-full shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-left md:w-auto md:text-right">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {dict.contestList.startTime}
                </dt>
                <dd className="font-mono text-sm text-slate-700 wrap-break-word">
                  {timerStartTime.toLocaleString(getLocale(lang), timeFormat)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {isRunningVp ? formatMessage(dict.contest.vpEndsAt, { attempt: latestVp.attemptNo }) : dict.contestList.endTime}
                </dt>
                <dd className="font-mono text-sm text-slate-700 wrap-break-word">
                  {timerEndTime.toLocaleString(getLocale(lang), timeFormat)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Ended contests already show their status chip, so the timer is only for upcoming or live ones. */}
          {(isLive || (contest.status === "PENDING" && now < contest.endTime)) && (
            <div className="contest-overview-timer mt-5 w-full">
              <ContestTimer
                startTime={timerStartTime}
                endTime={timerEndTime}
                frozenDuration={isRunningVp ? 0 : frozenDuration}
                endedLabel={isRunningVp ? dict.virtualParticipation.statusFinished : dict.contest.ENDED}
              />
            </div>
          )}
        </div>
        <div className="w-full print:bg-white">{children}</div>
      </div>
    </div>
  );
}
