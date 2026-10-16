import { requireContestAccess } from "@/lib/contest-access";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { ContestRole, PrintJobStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import PrintQueueClient from "./PrintQueueClient";

interface Props {
  params: Promise<{ contestId: string }>;
}

export default async function PrintQueuePage({ params }: Props) {
  const { contestId } = await params;
  const cid = Number(contestId);
  await requireContestAccess(cid);

  const [user, superAdmin] = await Promise.all([
    getCurrentUser(),
    getCurrentSuper(),
  ]);
  const payload = user as UserJwtPayload | null;
  const isAuthorized =
    !!superAdmin?.isGlobalAdmin ||
      (payload?.contestId === cid &&
        (payload.role === ContestRole.ADMIN ||
          payload.role === ContestRole.JUDGE ||
        payload.role === ContestRole.PRINT));

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">403</h1>
        <p className="text-xl text-gray-600 mb-8">Access Denied</p>
        <p className="text-gray-500 max-w-md">
          Only contest staff can access the print queue.
        </p>
      </div>
    );
  }

  const jobs = await prisma.printJob.findMany({
    where: {
      contestId: cid,
      status: {
        in: [PrintJobStatus.PENDING, PrintJobStatus.PRINTING],
      },
    },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          seat: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  const rejectedJobs = await prisma.printJob.findMany({
    where: { contestId: cid, status: PrintJobStatus.FAILED },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          seat: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const recentPrinted = await prisma.printJob.findMany({
    where: { contestId: cid, status: PrintJobStatus.PRINTED },
    include: {
      user: {
        select: {
          username: true,
          displayName: true,
          seat: true,
        },
      },
    },
    orderBy: { printedAt: "desc" },
    take: 10,
  });

  return (
    <PrintQueueClient
      contestId={cid}
      jobs={jobs}
      rejectedJobs={rejectedJobs}
      recentPrinted={recentPrinted}
    />
  );
}
