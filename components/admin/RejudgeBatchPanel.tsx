"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  countRejudgeCandidates,
  rejudgeByFilters,
  type RejudgeFilters,
} from "@/app/admin/submissions/actions";
import ConfirmModal from "./ConfirmModal";
import { getVerdictLabel } from "@/lib/dictionaries";

const VERDICT_OPTIONS = [
  { value: "WRONG_ANSWER" },
  { value: "TIME_LIMIT_EXCEEDED" },
  { value: "MEMORY_LIMIT_EXCEEDED" },
  { value: "RUNTIME_ERROR" },
  { value: "COMPILE_ERROR" },
  { value: "PRESENTATION_ERROR" },
  { value: "SYSTEM_ERROR" },
  { value: "ACCEPTED" },
];

const MAX_BATCH = 5000;

export default function RejudgeBatchPanel() {
  const { t } = useAdminLocale();
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
  const notifyLoadError = useEffectEvent(() => toast.error(t("Failed to load contest/problem list", "加载比赛或题目失败")));

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
        notifyLoadError();
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

  // datetime-local 不携带时区；在浏览器按管理员本地时间解析后转换成 ISO，
  // 避免服务端按 UTC 解析造成筛选时间偏移。空值保持为空。
  const getServerFilters = (): RejudgeFilters => ({
    ...filters,
    from: filters.from ? new Date(filters.from).toISOString() : "",
    to: filters.to ? new Date(filters.to).toISOString() : "",
  });

  const handlePreview = async () => {
    setCounting(true);
    try {
      const result = await countRejudgeCandidates(getServerFilters());
      if (result.error) {
        toast.error(result.error);
        setCount(null);
        return;
      }
      setCount(result.count ?? null);
    } catch {
      toast.error(t("Failed to count submissions", "统计提交失败"));
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
      const result = await rejudgeByFilters(getServerFilters());
      if (result.error && result.queued === undefined) {
        toast.error(result.error);
        return;
      }
      const message = t(
        `${result.queued ?? 0} queued, ${result.skipped ?? 0} skipped, ${result.failed ?? 0} failed`,
        `已入队 ${result.queued ?? 0} 条，跳过 ${result.skipped ?? 0} 条，入队失败 ${result.failed ?? 0} 条`,
      );
      if (result.error) toast.error(`${result.error} ${message}`);
      else if (result.failed) toast.error(message);
      else toast.success(message);
      setCount(null);
      router.refresh();
    } catch {
      toast.error(t("Failed to rejudge submissions", "提交重判失败"));
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
      <ConfirmModal cancelText={t("Cancel", "取消")}
        isOpen={confirmOpen}
        title={t("Batch Rejudge", "批量重判")}
        message={t(`Reset and rejudge ${count} submissions?`, `将清除 ${count} 条提交的旧结果并重新排队评测。确认重判？`)}
        confirmText={t("Rejudge", "重判")}
        isDestructive
        onConfirm={handleRejudge}
        onCancel={() => setConfirmOpen(false)}
      />

      <details className="admin-card overflow-hidden open:pb-4">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:-outline-offset-2">
          {t("Batch rejudge", "批量重判")}
        </summary>

        <div className="mt-2 grid grid-cols-1 gap-3 px-4 md:grid-cols-3">
          <div>
            <label className={labelClass}>{t("Contest (optional)", "比赛（可选）")}</label>
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
              <option value="">{t("All contests", "全部比赛")}</option>
              {contests.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id} - {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>{t("Problem (optional)", "题目（可选）")}</label>
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
              <option value="">{t("All problems", "全部题目")}</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} - {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>{t("Verdict (optional)", "结果（可选）")}</label>
            <select
              className={selectClass + " w-full"}
              value={filters.verdict ?? ""}
              onChange={(e) =>
                setField("verdict", e.target.value || null)
              }
            >
              <option value="">
                {filters.includeAccepted
                  ? t("All verdicts (incl. AC)", "所有结果（含 AC）")
                  : t("All verdicts (excl. AC)", "所有结果（不含 AC）")}
              </option>
              {verdictOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {getVerdictLabel(o.value)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>{t("Team or user (optional)", "队伍 / 用户（可选，模糊匹配）")}</label>
            <input
              type="text"
              className={inputClass + " w-full"}
              placeholder={t("Team, username, school, or seat", "队名、账号、学校或座位号")}
              value={filters.username ?? ""}
              onChange={(e) => setField("username", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>{t("Submitted from (optional)", "提交起始时间（可选）")}</label>
            <input
              type="datetime-local"
              className={inputClass + " w-full"}
              value={filters.from ?? ""}
              onChange={(e) => setField("from", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>{t("Submitted to (optional)", "提交截止时间（可选）")}</label>
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
              {t("Include accepted submissions (excluded by default)", "包含已 AC 的提交（默认排除，避免改动数据后误伤已有成绩）")}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:col-span-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={counting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {counting ? t("Counting...", "正在统计…") : t("Count matching submissions", "统计符合条件的提交")}
            </button>

            {count !== null && (
              <>
                <span className="text-sm text-gray-600">
                  {t("Selected for rejudge:", "将重测")}{" "}
                  <span className="font-bold text-blue-600">{count}</span>{" "}
                  {t("submissions (limit:", "条提交（上限")} {MAX_BATCH} {t(")", "条）")}
                </span>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={count === 0 || rejudging}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rejudging ? t("Rejudging...", "正在重判…") : t("Confirm rejudge", "确认重测")}
                </button>
              </>
            )}
          </div>
        </div>
      </details>
    </>
  );
}
