import { requireContestAccess } from "@/lib/contest-access";
import { getDictionary } from "@/lib/get-dictionary";
import { formatMessage } from "@/lib/dictionaries";
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

  const { nav } = await getDictionary();
  return {
    title: contest ? `${nav.editorial} - ${contest.title}` : nav.editorial,
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
  const dict = await getDictionary();

  return (
    <div className="bg-white w-full mx-auto shadow-sm border border-slate-200 rounded-2xl p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-gray-800">
            {dict.nav.editorial}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{contest.title}</p>
        </div>
        <a
          href={`/api/contests/${contestId}/editorial`}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline"
        >
          {dict.editorial.openPdf}
        </a>
      </div>
      <iframe
        src={`/api/contests/${contestId}/editorial`}
        className="h-[75vh] w-full rounded-xl border border-slate-200"
        title={formatMessage(dict.editorial.pdfTitle, { contest: contest.title })}
      />
    </div>
  );
}
