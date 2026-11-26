import Link from "next/link";
import { ContestStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/get-dictionary";
import { formatMessage } from "@/lib/dictionaries";
import { usesDomjudge } from "@/lib/contest-interface";
import {
  getViewerProblemProgress,
  type ProblemProgressState,
  type ProgressViewer,
} from "@/lib/viewer-problem-progress";

interface Props {
  contestId: number;
  contestStatus: ContestStatus;
  currentDisplayId: string;
  viewer: ProgressViewer;
}

const cellTone: Record<ProblemProgressState, string> = {
  solved: "bg-emerald-500 text-white ring-emerald-600/40 hover:bg-emerald-600",
  attempted: "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100",
  pending: "bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100",
  none: "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
};

const legendDot: Record<ProblemProgressState, string> = {
  solved: "bg-emerald-500",
  attempted: "bg-red-200 ring-1 ring-red-300",
  pending: "bg-blue-200 ring-1 ring-blue-300",
  none: "bg-white ring-1 ring-slate-300",
};

/** Grid of every contest problem showing the viewer's progress; each cell links to its statement. */
export default async function ProblemAnswerSheet({ contestId, contestStatus, currentDisplayId, viewer }: Props) {
  if (contestStatus === ContestStatus.PENDING || await usesDomjudge(contestId)) return null;

  const [dict, problems, { personal, progress }] = await Promise.all([
    getDictionary(),
    prisma.contestProblem.findMany({
      where: { contestId },
      orderBy: { displayId: "asc" },
      select: { problemId: true, displayId: true, color: true, problem: { select: { title: true } } },
    }),
    getViewerProblemProgress(contestId, viewer),
  ]);
  if (problems.length === 0) return null;

  const labels: Record<ProblemProgressState, string> = {
    solved: dict.problemList.legendSolved,
    attempted: dict.problemList.legendAttempted,
    pending: dict.problemList.legendPending,
    none: dict.problemList.legendUnsubmitted,
  };
  const solvedCount = problems.filter(p => progress.get(p.problemId)?.state === "solved").length;

  return (
    <section
      aria-labelledby="answer-sheet-title"
      className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:w-72"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 id="answer-sheet-title" className="font-bold text-gray-700">{dict.problemList.answerSheet}</h3>
        {personal && (
          <span className="text-xs font-medium tabular-nums text-slate-500">
            {formatMessage(dict.problemList.solvedSummary, { solved: solvedCount, total: problems.length })}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-5 gap-2 p-4">
        {problems.map(problem => {
          const entry = progress.get(problem.problemId);
          const state = entry?.state ?? "none";
          const current = problem.displayId === currentDisplayId;
          const status = personal
            ? state === "attempted" ? formatMessage(dict.problemList.attempted, { count: entry?.tries ?? 0 }) : labels[state]
            : null;
          const label = [`${problem.displayId}. ${problem.problem.title}`, status].filter(Boolean).join(" · ");
          return (
            <li key={problem.problemId}>
              <Link
                href={`/contest/${contestId}/problems/${encodeURIComponent(problem.displayId)}`}
                aria-current={current ? "page" : undefined}
                aria-label={label}
                title={label}
                className={`relative flex aspect-square items-center justify-center rounded-lg text-sm font-bold ring-1 ring-inset transition motion-safe:hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${cellTone[state]} ${current ? "outline-2 outline-offset-2 outline-blue-500" : ""}`}
              >
                <span className="max-w-full truncate px-0.5">{problem.displayId}</span>
                {problem.color && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1 size-1.5 rounded-full ring-1 ring-black/15"
                    style={{ backgroundColor: problem.color }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {personal && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          {(Object.keys(labels) as ProblemProgressState[]).map(state => (
            <li key={state} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2.5 rounded-sm ${legendDot[state]}`} />
              {labels[state]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
