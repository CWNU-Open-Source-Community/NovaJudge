// Shared pill styles for submission verdicts in the NovaJudge interface.
const verdictTone: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 ring-slate-200",
  JUDGING: "bg-blue-50 text-blue-700 ring-blue-200",
  ACCEPTED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  WRONG_ANSWER: "bg-red-50 text-red-700 ring-red-200",
  TIME_LIMIT_EXCEEDED: "bg-amber-50 text-amber-700 ring-amber-200",
  MEMORY_LIMIT_EXCEEDED: "bg-orange-50 text-orange-700 ring-orange-200",
  RUNTIME_ERROR: "bg-purple-50 text-purple-700 ring-purple-200",
  COMPILE_ERROR: "bg-yellow-50 text-yellow-800 ring-yellow-300",
  PRESENTATION_ERROR: "bg-orange-50 text-orange-700 ring-orange-200",
  SYSTEM_ERROR: "bg-slate-800 text-white ring-slate-900",
  FROZEN: "bg-sky-50 text-sky-700 ring-sky-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
};

const pillBase =
  "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset";

export function verdictPillClass(verdict: string) {
  return `${pillBase} ${verdictTone[verdict] ?? "bg-slate-100 text-slate-500 ring-slate-200"}`;
}
