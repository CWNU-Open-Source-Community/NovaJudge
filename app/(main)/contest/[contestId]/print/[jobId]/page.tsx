import { requireContestAccess } from "@/lib/contest-access";
import { notFound } from "next/navigation";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import AutoPrint from "./AutoPrint";
import PrintAgainButton from "./PrintAgainButton";

interface Props {
  params: Promise<{ contestId: string; jobId: string }>;
  searchParams: Promise<{ auto?: string; preview?: string }>;
}

function formatTime(date: Date) {
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default async function PrintTemplatePage({ params, searchParams }: Props) {
  const { contestId, jobId } = await params;
  const query = await searchParams;
  const cid = Number(contestId);
  await requireContestAccess(cid);
  const jid = Number(jobId);
  if (!Number.isInteger(cid) || !Number.isInteger(jid)) return notFound();

  const [user, superAdmin, job] = await Promise.all([
    getCurrentUser(),
    getCurrentSuper(),
    prisma.printJob.findFirst({
      where: { id: jid, contestId: cid },
      include: {
        contest: { select: { title: true } },
        user: {
          select: {
            username: true,
            displayName: true,
            seat: true,
            school: true,
          },
        },
      },
    }),
  ]);

  if (!job) return notFound();

  const payload = user as UserJwtPayload | null;
  const isAuthorized =
    !!superAdmin?.isGlobalAdmin ||
      (payload?.contestId === cid &&
        (payload.role === ContestRole.ADMIN ||
          payload.role === ContestRole.JUDGE ||
        payload.role === ContestRole.PRINT));

  if (!isAuthorized) return notFound();

  const teamName = job.user.displayName || job.user.username;
  const autoPrint = query.auto === "1";
  const isPreview = query.preview === "1";

  return (
    <main className="print-sheet bg-white text-black min-h-screen px-6 py-6">
      {isPreview && (
        <style>{`
          nav, footer { display: none !important; }
          body > div > main {
            display: block !important;
            padding: 0 !important;
            background: #fff !important;
          }
        `}</style>
      )}
      <AutoPrint enabled={autoPrint} />
      {!isPreview && (
        <div className="no-print mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Print Preview #{job.id}</h1>
          <p className="text-sm text-gray-500">
            Review this page, then print when ready.
          </p>
        </div>
        <PrintAgainButton />
      </div>
      )}

      <section className="print-document">
        <header className="print-header">
          <div>
            <h1 className="print-title">Code Printout</h1>
            <p className="print-subtitle">{job.contest.title}</p>
          </div>
          <div className="print-job-id">#{job.id}</div>
        </header>

        <section className="print-meta">
          <div>
            <span>Team Name</span>
            <strong>{teamName}</strong>
          </div>
          <div>
            <span>Team ID</span>
            <strong>{job.user.username}</strong>
          </div>
          <div>
            <span>Seat</span>
            <strong>{job.user.seat || "-"}</strong>
          </div>
          <div>
            <span>School</span>
            <strong>{job.user.school || "-"}</strong>
          </div>
          <div>
            <span>Language</span>
            <strong>{job.language}</strong>
          </div>
          <div>
            <span>File</span>
            <strong>{job.sourceFilename || "-"}</strong>
          </div>
          <div>
            <span>Requested At</span>
            <strong>{formatTime(job.createdAt)}</strong>
          </div>
        </section>

        <pre className="print-code">{job.code}</pre>
      </section>
    </main>
  );
}
