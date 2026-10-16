import { requireContestAccess } from "@/lib/contest-access";
import { Contest, ContestConfig } from "@/app/(main)/page";
import ContestNoticeSniffer from "@/components/ContestNoticeSniffer";
import ContestTimer from "@/components/ContestTimer";
import { getCurrentSuper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLatestVirtualParticipation } from "@/lib/virtual-participation";

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

  if (!contest) return <div>Contest not found</div>;
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

  return (
    <div className="w-full overflow-x-hidden print:bg-white">
      <ContestNoticeSniffer contestId={Number(contestId)} />
      <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6 print:max-w-none print:px-0 print:py-0 print:space-y-0 print:bg-white">
        <div className="bg-white shadow-sm border border-gray-100 rounded-sm p-4 md:p-6 print:hidden">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div className="w-full md:w-auto">
              <h1 className="text-xl md:text-3xl font-serif font-bold text-gray-900 mb-2 wrap-break-word">
                {contest.title}
              </h1>
              <div className="flex flex-wrap gap-4 text-xs md:text-sm text-gray-500">
                <span>
                  ID:{" "}
                  <span className="font-mono text-gray-700">{contest.id}</span>
                </span>
                <span>
                  Type:{" "}
                  <span className="font-bold text-blue-700">
                    {contest.type}
                  </span>
                </span>
                <span>
                  Status:{" "}
                  <span className="font-bold text-red-600">
                    {isRunningVp ? "VP Running" : contest.status}
                  </span>
                </span>
              </div>
            </div>

            <div className="text-left md:text-right w-full md:w-auto">
              <div className="text-xs text-gray-400 uppercase">
                {isRunningVp ? `VP #${latestVp.attemptNo} Ends At` : "Ends At"}
              </div>
              <div className="text-sm md:text-base text-gray-800 font-mono wrap-break-word">
                {timerEndTime.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="mt-6 w-full">
            <ContestTimer
              startTime={timerStartTime}
              endTime={timerEndTime}
              frozenDuration={isRunningVp ? 0 : frozenDuration}
              endedLabel={isRunningVp ? "VP Ended" : "Contest Ended"}
            />
          </div>
        </div>
        <div className="w-full print:bg-white">{children}</div>
      </div>
    </div>
  );
}
