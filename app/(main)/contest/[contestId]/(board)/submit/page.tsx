import { requireContestAccess } from "@/lib/contest-access";
import { notFound } from "next/navigation";
import ProblemInfoCard from "@/components/ProblemInfoCard";
import ProblemAnswerSheet from "@/components/contest/ProblemAnswerSheet";
import { prisma } from "@/lib/prisma";
import SubmitForm from "./client";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import {
  ContestRole,
  ContestStatus,
  Verdict,
} from "@/lib/generated/prisma/client";
import { Metadata } from "next";
import Link from "next/link";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { isCliEnabled } from "@/lib/cli-deployment";
import {
  getLatestVirtualParticipation,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";
import { getDictionary } from "@/lib/get-dictionary";
import { usesDomjudge } from "@/lib/contest-interface";
import { getDomjudgeContest } from "@/lib/domjudge-contest";
import DomjudgeSubmit from "@/components/contest/DomjudgeSubmit";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);

  const contest = await prisma.contest.findFirst({
    where: {
      id: contestId,
    },
  });

  const dict = await getDictionary();
  if (!contest) {
    return {
      title: dict.contestList.notFound,
    };
  }
  return {
    title: `${dict.submit.title} - ${contest.title}`,
  };
}
interface Props {
  searchParams: Promise<{ problem?: string; entry?: string }>;
  params: Promise<{ contestId: string }>;
}

export default async function SubmitPage({ params, searchParams }: Props) {
  const { contestId } = await params;
  const { problem: displayId, entry } = await searchParams;
  if (!displayId) return notFound();

  const cid = Number(contestId);
  await requireContestAccess(cid);
  const contestProblem = await prisma.contestProblem.findFirst({
    where: { contestId: cid, displayId },
    include: {
      problem: true,
      contest: {
        select: {
          startTime: true,
          endTime: true,
          status: true,
          config: true,
        },
      },
    },
  });
  if (!contestProblem) return notFound();
  const { problem } = contestProblem;
  const domjudge = await usesDomjudge(cid);
  if (domjudge && contestProblem.contest.status === ContestStatus.PENDING) return notFound();
  const dict = await getDictionary();
  if (domjudge && entry === "file") {
    const contest = await getDomjudgeContest(cid);
    if (!contest) return notFound();
    return <section className="dj-upload-page">
      <h1>{dict.submit.title}</h1>
      <DomjudgeSubmit contest={contest} initialProblem={displayId} />
    </section>;
  }

  const SuperAdmin = await getCurrentSuper();
  const user = await getCurrentUser();

  const currentRole = (user as unknown as UserJwtPayload)?.role;
  const currentContestId = (user as unknown as UserJwtPayload)?.contestId;
  const globalUserId = (SuperAdmin as unknown as UserJwtPayload)?.userId;
  const isExternalUser =
    Boolean(SuperAdmin?.externalId) && !SuperAdmin?.isGlobalAdmin;
  const isContestEnded =
    contestProblem.contest.status === ContestStatus.ENDED ||
    new Date() >= contestProblem.contest.endTime;
  const runningVp =
    !user && globalUserId
      ? await getRunningVirtualParticipation(cid, String(globalUserId))
      : null;
  const latestVp =
    !user && globalUserId
      ? await getLatestVirtualParticipation(cid, String(globalUserId))
      : null;

  const contestConfig = contestProblem.contest.config as {
    frozenDuration?: number;
  } | null;
  const frozenDuration = contestConfig?.frozenDuration ?? 0;
  let officialVisibleUntil = contestProblem.contest.endTime;
  let officialUpperBoundExclusive = false;

  if (frozenDuration > 0) {
    officialVisibleUntil = new Date(
      contestProblem.contest.endTime.getTime() -
        frozenDuration * 60 * 1000,
    );
    officialUpperBoundExclusive = true;
  }

  if (runningVp) {
    officialVisibleUntil = new Date(
      Math.min(
        contestProblem.contest.startTime.getTime() +
          (new Date().getTime() - runningVp.startedAt.getTime()),
        contestProblem.contest.endTime.getTime(),
      ),
    );
    officialUpperBoundExclusive = false;
  }

  const officialWhere = getOfficialSubmissionWhere({
    contestId: cid,
    startTime: contestProblem.contest.startTime,
    endTime: contestProblem.contest.endTime,
    visibleUntil: officialVisibleUntil,
    exclusiveUpperBound: officialUpperBoundExclusive,
  });

  const [officialTotalStats, officialAcStats, vpTotalStats, vpAcStats] =
    await Promise.all([
      prisma.submission.count({
        where: {
          ...officialWhere,
          problemId: problem.id,
        },
      }),
      prisma.submission.count({
        where: {
          ...officialWhere,
          problemId: problem.id,
          verdict: Verdict.ACCEPTED,
        },
      }),
      latestVp
        ? prisma.submission.count({
            where: {
              contestId: cid,
              problemId: problem.id,
              virtualParticipationId: latestVp.id,
              submittedAt: {
                gte: latestVp.startedAt,
                lte: latestVp.endedAt,
              },
            },
          })
        : Promise.resolve(0),
      latestVp
        ? prisma.submission.count({
            where: {
              contestId: cid,
              problemId: problem.id,
              verdict: Verdict.ACCEPTED,
              virtualParticipationId: latestVp.id,
              submittedAt: {
                gte: latestVp.startedAt,
                lte: latestVp.endedAt,
              },
            },
          })
        : Promise.resolve(0),
    ]);

  const totalStats = officialTotalStats + vpTotalStats;
  const acStats = officialAcStats + vpAcStats;

  const info = {
    timeLimit: problem.defaultTimeLimit,
    memoryLimit: problem.defaultMemoryLimit,
    submissions: totalStats,
    accepted: acStats,
    problemType: problem.type,
  };

  const isAdmin =
    (SuperAdmin as unknown as UserJwtPayload)?.isGlobalAdmin ||
    currentRole === ContestRole.ADMIN ||
    currentRole === ContestRole.JUDGE;
  const isSubmitDisabled =
    (!!user &&
      (currentRole !== ContestRole.TEAM || currentContestId !== cid)) ||
    (!user && !runningVp && !(isExternalUser && isContestEnded));
  return (
    <div className="flex flex-col w-full lg:flex-row gap-6 items-start">
      <aside className="w-full lg:w-72 shrink-0 space-y-4">
        <ProblemAnswerSheet
          contestId={cid}
          contestStatus={contestProblem.contest.status}
          currentDisplayId={displayId}
          viewer={{
            userId: (user as unknown as UserJwtPayload)?.userId,
            globalUserId,
            runningVpId: runningVp?.id,
            latestVpId: latestVp?.id,
            externalAfterContest: isExternalUser && isContestEnded,
          }}
        />
        <ProblemInfoCard
          contestId={contestId}
          problemId={displayId}
          info={info}
          type="submit"
          isAdmin={isAdmin}
        />
      </aside>

      <div className="flex-1 w-full min-w-0 space-y-4">
        {domjudge && !isSubmitDisabled &&
          <Link href={`/contest/${cid}/submit?problem=${encodeURIComponent(displayId)}&entry=file`} className="dj-secondary">{dict.domjudge.uploadFile}</Link>}
        <SubmitForm
          contestId={contestId}
          problemId={displayId}
          isAdmin={isSubmitDisabled}
        />
        {isCliEnabled() && <Link
          href="/cli"
          className="flex items-start gap-3 bg-white border border-slate-200 shadow-sm rounded-2xl p-4 hover:border-blue-300 transition-colors"
        >
          <CommandLineIcon className="w-5 h-5 shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-gray-800">{dict.submit.cliTitle}</p>
            <p className="text-sm text-gray-600 mt-1">
              {dict.submit.cliDescription}
            </p>
          </div>
        </Link>}
      </div>
    </div>
  );
}
