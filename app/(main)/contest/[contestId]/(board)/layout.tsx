import { requireContestAccess } from "@/lib/contest-access";
import { getDictionary, getLanguage } from "@/lib/get-dictionary";
import { formatMessage, getLocale } from "@/lib/dictionaries";
import { Contest, ContestConfig } from "@/app/(main)/page";
import ContestNoticeSniffer from "@/components/ContestNoticeSniffer";
import ContestTimer from "@/components/ContestTimer";
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

  return (
    <div className="contest-board w-full overflow-x-hidden print:bg-white">
      <ContestNoticeSniffer contestId={Number(contestId)} />
      <div className="contest-board-inner w-full max-w-7xl mx-auto px-4 py-6 space-y-6 print:max-w-none print:px-0 print:py-0 print:space-y-0 print:bg-white">
        <div className="contest-overview bg-white shadow-sm border border-gray-100 rounded-sm p-4 md:p-6 print:hidden">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div className="w-full md:w-auto">
              <h1 className="text-xl md:text-3xl font-serif font-bold text-gray-900 mb-2 wrap-break-word">
                {contest.title}
              </h1>
              <p className="rank-contest-status hidden">{boardStatus}</p>
              <div className="contest-overview-meta flex flex-wrap gap-4 text-xs md:text-sm text-gray-500">
                <span>
                  {dict.common.id}{" · "}
                  <span className="font-mono text-gray-700">{contest.id}</span>
                </span>
                <span>
                  {dict.contestList.type}{" · "}
                  <span className="font-bold text-blue-700">
                    {contest.type === "PRIVATE" ? dict.contestList.private : dict.contestList.public}
                  </span>
                </span>
                <span>
                  {dict.contestList.status}{" · "}
                  <span className="font-bold text-red-600">
                    {isRunningVp ? dict.contest.vpRunning : dict.contest[contest.status]}
                  </span>
                </span>
              </div>
            </div>

            <div className="contest-overview-deadline text-left md:text-right w-full md:w-auto">
              <div className="text-xs text-gray-400 uppercase">
                {isRunningVp ? formatMessage(dict.contest.vpEndsAt, { attempt: latestVp.attemptNo }) : dict.contestList.endTime}
              </div>
              <div className="text-sm md:text-base text-gray-800 font-mono wrap-break-word">
                {timerEndTime.toLocaleString(getLocale(lang))}
              </div>
            </div>
          </div>

          <div className="contest-overview-timer mt-6 w-full">
            <ContestTimer
              startTime={timerStartTime}
              endTime={timerEndTime}
              frozenDuration={isRunningVp ? 0 : frozenDuration}
              endedLabel={isRunningVp ? dict.virtualParticipation.statusFinished : dict.contest.ENDED}
            />
          </div>
        </div>
        <div className="w-full print:bg-white">{children}</div>
      </div>
    </div>
  );
}
