'use client';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getProblems } from "./actions";
import {
  PencilSquareIcon,
  ServerStackIcon,
  BeakerIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import Pagination from "@/components/admin/AdminPagination";
import { AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import RejudgeButton from "./RejudgeProblemButton";
import DeleteProblemButton from "./DeleteProblemButton";
import UpdateProblemButton from "./UpdateProblemButton";
import { toast } from "sonner";

const problemTypes = {
  default: { en: "Standard I/O", zh: "标准输入输出", color: "bg-gray-100 text-gray-700" },
  spj: { en: "Special Judge", zh: "自定义判定", color: "bg-purple-100 text-purple-700" },
  interactive: { en: "Interactive", zh: "交互题", color: "bg-gray-100 text-gray-700" },
  communication: { en: "Communication", zh: "两轮通信", color: "bg-blue-100 text-blue-700" },
};

export default function ProblemsPage() {
  const { t, locale } = useAdminLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const searchParams = useSearchParams();
  const currentPage = Number(searchParams.get("page")) || 1;
  const [problems, setProblems] = useState<Array<{
    id: number;
    title: string;
    type: string;
    updatedAt: Date;
  }>>([]);
  const [total, setTotal] = useState(0);
  const [selectedProblemIds, setSelectedProblemIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const loadProblems = useCallback(async (page: number, signal?: AbortSignal) => {
    const { problems, total } = await getProblems(page);
    if (signal?.aborted) return;
    setProblems(problems);
    setTotal(total);
    setSelectedProblemIds(new Set());
    setLoadFailed(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadProblems(currentPage, signal)
      .catch(() => { if (!signal.aborted) setLoadFailed(true); })
      .finally(() => { if (!signal.aborted) setLoadingProblems(false); });
    return () => controller.abort();
  }, [currentPage, loadProblems]);

  function toggleProblemSelection(problemId: number) {
    const newSelected = new Set(selectedProblemIds);
    if (newSelected.has(problemId)) {
      newSelected.delete(problemId);
    } else {
      newSelected.add(problemId);
    }
    setSelectedProblemIds(newSelected);
  }

  function selectAllProblems() {
    if (selectedProblemIds.size === problems.length) {
      setSelectedProblemIds(new Set());
    } else {
      setSelectedProblemIds(new Set(problems.map(p => p.id)));
    }
  }

  async function handleExport() {
    if (selectedProblemIds.size === 0) {
      toast.error(t("Select at least one problem to export.", "请至少选择一道题。"));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/problems/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ problemIds: Array.from(selectedProblemIds) }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `problems_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(t(`Exported ${selectedProblemIds.size} problems.`, `已导出 ${selectedProblemIds.size} 道题。`));
    } catch {
      toast.error(t("Export failed. Please retry.", "导出失败，请重试。"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("Problem Bank", "题库")} description={t("Author, import, test, and maintain judge data.", "新建或导入题目，管理测试数据并调试样例。")}>
        <Link href="/admin/problems/import" className="admin-button">
          <ArrowUpTrayIcon className="size-4" aria-hidden="true" />
          {t("Import", "导入")}
        </Link>
        <Link href="/admin/problems/create" className="admin-button admin-button-primary">
          <PlusIcon className="size-4" aria-hidden="true" />
          {t("Create problem", "创建题目")}
        </Link>
      </AdminPageHeader>

      <section className="admin-card overflow-hidden" aria-busy={loadingProblems}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 sm:px-4">
          <p role="status" className="text-sm text-gray-600">
            {t(`${selectedProblemIds.size} selected`, `已选 ${selectedProblemIds.size} 道题`)}
          </p>
          <button type="button" onClick={handleExport} disabled={isLoading || selectedProblemIds.size === 0} className="admin-button admin-button-small">
            <ArrowDownTrayIcon className="size-4" aria-hidden="true" />
            {isLoading ? t("Exporting…", "正在导出…") : t("Export ZIP", "导出 ZIP")}
          </button>
        </div>
        <AdminTable label={t("Problems", "题目列表")} className="min-w-[21.5rem]">
          <thead>
            <tr>
              <th scope="col" className="w-11">
                <input type="checkbox" aria-label={t("Select problems on this page", "选择本页题目")} checked={problems.length > 0 && selectedProblemIds.size === problems.length} onChange={selectAllProblems} disabled={!problems.length} className="admin-checkbox" />
              </th>
              <th scope="col">{t("Problem", "题目")}</th>
              <th scope="col" className="hidden lg:table-cell">{t("Updated", "更新时间")}</th>
              <th scope="col" className="min-w-32 text-right">{t("Actions", "操作")}</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => {
              const problemType = problemTypes[problem.type as keyof typeof problemTypes];
              return (
                <tr key={problem.id}>
                  <td className="align-top">
                    <input type="checkbox" aria-label={t(`Select ${problem.title}`, `选择 ${problem.title}`)} checked={selectedProblemIds.has(problem.id)} onChange={() => toggleProblemSelection(problem.id)} className="admin-checkbox" />
                  </td>
                  <th scope="row" className="min-w-32 text-left align-top font-normal">
                    <Link href={`/admin/problems/${problem.id}/test`} className="admin-text-link wrap-break-word font-semibold" title={t("Test problem", "测试题目")}>{problem.title}</Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-mono text-gray-600">#{problem.id}</span>
                      <span className={`rounded-md px-2 py-1 font-medium ${problemType?.color ?? "bg-gray-100 text-gray-700"}`}>
                        {problemType ? t(problemType.en, problemType.zh) : problem.type}
                      </span>
                    </div>
                  </th>
                  <td className="hidden text-xs text-gray-600 lg:table-cell">
                    <time dateTime={problem.updatedAt.toISOString()}>{dateFormat.format(problem.updatedAt)}</time>
                  </td>
                  <td>
                    <div className="ml-auto grid w-max grid-cols-3 gap-1.5 sm:grid-cols-6">
                      <Link href={`/admin/problems/${problem.id}/test`} className="admin-icon-button text-orange-600" title={t("Test problem", "测试题目")} aria-label={t("Test problem", "测试题目")}>
                        <BeakerIcon className="size-[18px]" aria-hidden="true" />
                      </Link>
                      <Link href={`/admin/problems/${problem.id}/data`} className="admin-icon-button text-purple-600" title={t("Manage data and configuration", "管理测试数据与配置")} aria-label={t("Manage data and configuration", "管理测试数据与配置")}>
                        <ServerStackIcon className="size-[18px]" aria-hidden="true" />
                      </Link>
                      <Link href={`/admin/problems/${problem.id}`} className="admin-icon-button text-blue-600" title={t("Edit problem", "编辑题目")} aria-label={t("Edit problem", "编辑题目")}>
                        <PencilSquareIcon className="size-[18px]" aria-hidden="true" />
                      </Link>
                      <UpdateProblemButton problemId={problem.id} problemTitle={problem.title} onUpdated={() => loadProblems(currentPage)} />
                      <RejudgeButton problemId={problem.id} />
                      <DeleteProblemButton problemId={problem.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {problems.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center">
                  <p role="status" className="py-7 text-sm text-gray-600">{loadingProblems ? t("Loading problems…", "正在加载题目…") : loadFailed ? t("Could not load problems. Refresh to retry.", "无法加载题目，请刷新后重试。") : t("No problems yet. Create or import a problem to get started.", "题库暂无题目。可以先创建或导入一道题。")}</p>
                </td>
              </tr>
            )}
          </tbody>
        </AdminTable>
        <div className="admin-table-footer">
          <Pagination totalItems={total} />
        </div>
      </section>
    </div>
  );
}
