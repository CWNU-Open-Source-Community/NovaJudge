"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  countRejudgeCandidates,
  rejudgeByFilters,
  type RejudgeFilters,
} from "@/app/admin/submissions/actions";
import ConfirmModal from "./ConfirmModal";

const VERDICT_OPTIONS: { value: string; label: string }[] = [
  { value: "WRONG_ANSWER", label: "Wrong Answer" },
  { value: "TIME_LIMIT_EXCEEDED", label: "Time Limit Exceeded" },
  { value: "MEMORY_LIMIT_EXCEEDED", label: "Memory Limit Exceeded" },
  { value: "RUNTIME_ERROR", label: "Runtime Error" },
  { value: "COMPILE_ERROR", label: "Compile Error" },
  { value: "PRESENTATION_ERROR", label: "Presentation Error" },
  { value: "SYSTEM_ERROR", label: "System Error" },
  { value: "ACCEPTED", label: "Accepted (需勾选“包含 AC”)" },
];

const MAX_BATCH = 5000;

export default function RejudgeBatchPanel() {
  const router = useRouter();

  const [contests, setContests] = useState<{ id: number; title: string }[]>([]);
  const [problems, setProblems] = useState<{ id: number; title: string }[]>([]);

  const [filters, setFilters] = useState<RejudgeFilters>({
    contestId: null,
    problemId: null,
    verdict: null,
    username: "",
    from: "",
    to: "",
    includeAccepted: false,
  });

  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [rejudging, setRejudging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 加载下拉选项
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/contests/all-simple").then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/admin/problems/simple").then((r) =>
        r.ok ? r.json() : [],
      ),
    ])
      .then(([contestList, problemList]) => {
        setContests(contestList as { id: number; title: string }[]);
        setProblems(problemList as { id: number; title: string }[]);
      })
      .catch(() => {
        toast.error("Failed to load contest/problem list");
      });
  }, []);

  // AC 选项只有在勾选「包含 AC」时才可选，避免出现矛盾条件
  const verdictOptions = useMemo(
    () =>
      VERDICT_OPTIONS.filter(
        (o) => o.value !== "ACCEPTED" || filters.includeAccepted,
      ),
    [filters.includeAccepted],
  );

  const setField = <K extends keyof RejudgeFilters>(
    key: K,
    value: RejudgeFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCount(null); // 条件变化后，旧的数量预览失效
  };

  const handlePreview = async () => {
    setCounting(true);
    try {
      const result = await countRejudgeCandidates(filters);
      if (result.error) {
        toast.error(result.error);
        setCount(null);
        return;
      }
      setCount(result.count ?? null);
    } catch {
      toast.error("Failed to count submissions");
      setCount(null);
    } finally {
      setCounting(false);
    }
  };

  const handleConfirm = () => {
    if (count === null || count === 0) return;
    setConfirmOpen(true);
  };

  const handleRejudge = async () => {
    setConfirmOpen(false);
    setRejudging(true);
    try {
      const result = await rejudgeByFilters(filters);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Rejudge request sent for ${result.queued} submissions`,
      );
      setCount(null);
      router.refresh();
    } catch {
      toast.error("Failed to rejudge submissions");
    } finally {
      setRejudging(false);
    }
  };

  const selectClass =
    "rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const inputClass =
    "rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const labelClass = "mb-1 block text-xs font-bold text-gray-600";

  return (
    <>
      <ConfirmModal
        isOpen={confirmOpen}
        title="Batch Rejudge"
        message={`This will reset and re-queue ${count} submissions for judging. Continue?`}
        confirmText="Rejudge"
        isDestructive
        onConfirm={handleRejudge}
        onCancel={() => setConfirmOpen(false)}
      />

      <details className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm open:pb-4">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50">
          ⚡ Batch Rejudge（按条件批量重测）
        </summary>

        <div className="mt-2 grid grid-cols-1 gap-3 px-4 md:grid-cols-3">
          <div>
            <label className={labelClass}>Contest（可选）</label>
            <select
              className={selectClass + " w-full"}
              value={filters.contestId ?? ""}
              onChange={(e) =>
                setField(
                  "contestId",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              <option value="">All contests</option>
              {contests.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id} - {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Problem（可选）</label>
            <select
              className={selectClass + " w-full"}
              value={filters.problemId ?? ""}
              onChange={(e) =>
                setField(
                  "problemId",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              <option value="">All problems</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} - {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Verdict（可选）</label>
            <select
              className={selectClass + " w-full"}
              value={filters.verdict ?? ""}
              onChange={(e) =>
                setField("verdict", e.target.value || null)
              }
            >
              <option value="">
                {filters.includeAccepted
                  ? "All verdicts (incl. AC)"
                  : "All verdicts (excl. AC)"}
              </option>
              {verdictOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Username（可选，模糊匹配）</label>
            <input
              type="text"
              className={inputClass + " w-full"}
              placeholder="e.g. team01 / admin"
              value={filters.username ?? ""}
              onChange={(e) => setField("username", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Submitted from（可选）</label>
            <input
              type="datetime-local"
              className={inputClass + " w-full"}
              value={filters.from ?? ""}
              onChange={(e) => setField("from", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Submitted to（可选）</label>
            <input
              type="datetime-local"
              className={inputClass + " w-full"}
              value={filters.to ?? ""}
              onChange={(e) => setField("to", e.target.value)}
            />
          </div>

          <div className="flex items-end md:col-span-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={filters.includeAccepted ?? false}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setFilters((prev) => ({
                    ...prev,
                    includeAccepted: checked,
                    // 取消勾选时若当前选的是 AC，则清空判定条件
                    verdict:
                      !checked && prev.verdict === "ACCEPTED"
                        ? null
                        : prev.verdict,
                  }));
                  setCount(null);
                }}
              />
              包含已 AC 的提交（默认排除，避免改动数据后误伤已有成绩）
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:col-span-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={counting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {counting ? "Counting..." : "查询符合条件的数量"}
            </button>

            {count !== null && (
              <>
                <span className="text-sm text-gray-600">
                  将重测{" "}
                  <span className="font-bold text-blue-600">{count}</span>{" "}
                  条提交（上限 {MAX_BATCH} 条）
                </span>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={count === 0 || rejudging}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rejudging ? "Rejudging..." : "确认重测"}
                </button>
              </>
            )}
          </div>
        </div>
      </details>
    </>
  );
}
