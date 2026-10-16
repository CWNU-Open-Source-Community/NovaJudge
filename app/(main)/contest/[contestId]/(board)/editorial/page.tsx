import { requireContestAccess } from "@/lib/contest-access";
import { getCurrentSuper, UserJwtPayload } from "@/lib/auth";
import { ContestStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import fs from "node:fs/promises";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import path from "node:path";
import { getRunningVirtualParticipation } from "@/lib/virtual-participation";

interface Props {
  params: Promise<{
    contestId: string;
  }>;
}

type ContestConfig = {
  editorialPdf?: {
    filename: string;
    uploadedAt: string;
  };
};

function getEditorialPdfPath(contestId: number) {
  return path.join(
    process.cwd(),
    "uploads",
    "contests",
    contestId.toString(),
    "editorial.pdf",
  );
}

async function hasEditorialPdf(contestId: number) {
  try {
    const stat = await fs.stat(getEditorialPdfPath(contestId));
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = Number((await params).contestId);
  await requireContestAccess(contestId);
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { title: true },
  });

  return {
    title: contest ? `Editorial - ${contest.title}` : "Editorial",
  };
}

export default async function EditorialPage({ params }: Props) {
  const contestId = Number((await params).contestId);
  await requireContestAccess(contestId);

  if (!Number.isInteger(contestId)) notFound();

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      config: true,
      status: true,
      title: true,
      type: true,
    },
  });

  if (!contest) notFound();

  const superUser = (await getCurrentSuper()) as UserJwtPayload | null;
  const isGlobalAdmin = !!superUser?.isGlobalAdmin;
  const runningVp =
    superUser?.userId && !isGlobalAdmin
      ? await getRunningVirtualParticipation(contestId, String(superUser.userId))
      : null;

  if (runningVp) notFound();

  const config = (contest.config as ContestConfig | null) || {};
  const available =
    contest.status === ContestStatus.ENDED &&
    !!config.editorialPdf &&
    (await hasEditorialPdf(contestId));

  if (!available) notFound();

  return (
    <div className="bg-white w-full mx-auto shadow-sm border border-gray-100 rounded-sm p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-gray-800">
            Editorial
          </h2>
          <p className="mt-1 text-sm text-gray-500">{contest.title}</p>
        </div>
        <a
          href={`/api/contests/${contestId}/editorial`}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open PDF
        </a>
      </div>
      <iframe
        src={`/api/contests/${contestId}/editorial`}
        className="h-[75vh] w-full rounded-sm border border-gray-200"
        title={`${contest.title} Editorial PDF`}
      />
    </div>
  );
}
