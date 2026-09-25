import { notFound } from "next/navigation";
import ProblemInfoCard from "@/components/ProblemInfoCard";
import { prisma } from "@/lib/prisma";
import SubmitForm from "./client";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { ContestRole, Verdict } from "@/lib/generated/prisma/client";
import { Metadata } from "next";
import {
  getLatestVirtualParticipation,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);

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
    title: `提交 - ${contest.title}`,
  };
}
interface Props {
  searchParams: Promise<{ problem?: string }>;
  params: Promise<{ contestId: string }>;
}

export default async function SubmitPage({ params, searchParams }: Props) {
  const { contestId } = await params;
  const { problem: displayId } = await searchParams;
  if (!displayId) return notFound();

  const cid = Number(contestId);
  const contestProblem = await prisma.contestProblem.findFirst({
    where: { contestId: cid, displayId },
    include: {
      problem: true,
      contest: {
        select: {
          startTime: true,
          endTime: true,
        },
      },
    },
  });
  if (!contestProblem) return notFound();
  const { problem } = contestProblem;

  const SuperAdmin = await getCurrentSuper();
  const user = await getCurrentUser();

  const currentRole = (user as unknown as UserJwtPayload)?.role;
  const globalUserId = (SuperAdmin as unknown as UserJwtPayload)?.userId;
  const runningVp =
    !user && globalUserId
      ? await getRunningVirtualParticipation(cid, String(globalUserId))
      : null;
  const latestVp =
    !user && globalUserId
      ? await getLatestVirtualParticipation(cid, String(globalUserId))
      : null;

  const dateFilter = runningVp
    ? {
        submittedAt: {
          lte: new Date(
            Math.min(
              contestProblem.contest.startTime.getTime() +
                (new Date().getTime() - runningVp.startedAt.getTime()),
              contestProblem.contest.endTime.getTime(),
            ),
          ),
        },
      }
    : {};

  const [officialTotalStats, officialAcStats, vpTotalStats, vpAcStats] =
    await Promise.all([
      prisma.submission.count({
        where: {
          contestId: cid,
          problemId: problem.id,
          virtualParticipationId: null,
          ...dateFilter,
        },
      }),
      prisma.submission.count({
        where: {
          contestId: cid,
          problemId: problem.id,
          verdict: Verdict.ACCEPTED,
          virtualParticipationId: null,
          ...dateFilter,
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
    (!!user && currentRole !== ContestRole.TEAM) || (!user && !runningVp);
  return (
    <div className="flex flex-col w-full lg:flex-row gap-6 items-start">
      <aside>
        <ProblemInfoCard
          contestId={contestId}
          problemId={displayId}
          info={info}
          type="submit"
          isAdmin={isAdmin}
        />
      </aside>

      <SubmitForm
        contestId={contestId}
        problemId={displayId}
        isAdmin={isSubmitDisabled}
      />
    </div>
  );
}
