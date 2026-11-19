"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getContests, toggleContestVisibility } from "./actions";
import Pagination from "@/components/admin/AdminPagination";
import { AdminContestStatus, AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import DeleteContestButton from "./DeleteContestButton";
import {
  PlusIcon,
  UserGroupIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PlayIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSquareIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { ContestType } from "@/lib/generated/prisma/enums";
import { toast } from "sonner";

interface Contest {
  id: number;
  title: string;
  status: string;
  type: string;
  startTime: Date;
  endTime: Date;
  visible: boolean;
  _count: {
    problems: number;
    users: number;
    submissions: number;
  };
}

export default function AdminContestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { t, lang, locale } = useAdminLocale();
  const [loadingContests, setLoadingContests] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [contests, setContests] = useState<Contest[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedContestIds, setSelectedContestIds] = useState<Set<number>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [includeData, setIncludeData] = useState(true);
  const pageSize = 15;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const allOnPageSelected = contests.length > 0 && contests.every((contest) => selectedContestIds.has(contest.id));

  useEffect(() => {
    let cancelled = false;
    async function loadContests() {
      try {
        const { page } = await searchParams;
        if (cancelled) return;
        setLoadingContests(true);
        setLoadFailed(false);
        const { contests, total } = await getContests(Number(page) || 1, pageSize);
        if (!cancelled) {
          setContests(contests);
          setTotal(total);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoadingContests(false);
      }
    }
    void loadContests();
    return () => { cancelled = true; };
  }, [searchParams]);

  function toggleContestSelection(contestId: number) {
    const newSelected = new Set(selectedContestIds);
    if (newSelected.has(contestId)) {
      newSelected.delete(contestId);
    } else {
      newSelected.add(contestId);
    }
    setSelectedContestIds(newSelected);
  }

  function selectAllContests() {
    if (allOnPageSelected) {
      setSelectedContestIds(new Set());
    } else {
      setSelectedContestIds(new Set(contests.map((c) => c.id)));
    }
  }

  async function handleExport() {
    if (selectedContestIds.size === 0) {
      toast.error(t("Select at least one contest to export.", "请至少选择一场比赛。"));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/contests/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contestIds: Array.from(selectedContestIds),
          includeData,
        }),
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contests_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        t(`Exported ${selectedContestIds.size} contests.`, `已导出 ${selectedContestIds.size} 场比赛。`),
      );
    } catch {
      toast.error(t("Export failed. Please retry.", "导出失败，请重试。"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVisibilityToggle(id: number, currentVisible: boolean) {
    try {
      await toggleContestVisibility(id, !currentVisible);
      setContests(
        (current) => current.map((c) =>
          c.id === id ? { ...c, visible: !currentVisible } : c,
        ),
      );
      toast.success(currentVisible ? t("Contest hidden from homepage.", "已从首页隐藏比赛。") : t("Contest shown on homepage.", "已在首页显示比赛。"));
    } catch {
      toast.error(t("Failed to update visibility.", "更新可见性失败。"));
    }
  }

  function handleContestDeleted(id: number) {
    setContests((current) => current.filter((contest) => contest.id !== id));
    setSelectedContestIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setTotal((current) => Math.max(0, current - 1));
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("Contest Management", "比赛管理")} description={t("Set schedules, assign problems, and manage contest accounts.", "安排赛程、配置题目和管理比赛账号。")}>
        <Link href="/admin/contests/import" className="admin-button">
          <ArrowUpTrayIcon className="size-4" aria-hidden="true" />
          {t("Import", "导入")}
        </Link>
        <Link href="/admin/contests/create" className="admin-button admin-button-primary">
          <PlusIcon className="size-4" aria-hidden="true" />
          {t("Create contest", "创建比赛")}
        </Link>
      </AdminPageHeader>

      <section className="admin-card overflow-hidden" aria-busy={loadingContests}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:px-4">
          <label className="flex min-h-8 cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={includeData} onChange={(e) => setIncludeData(e.target.checked)} className="admin-checkbox" />
            {t("Include test data", "包含测试数据")}
          </label>
          <button type="button" onClick={handleExport} disabled={isLoading || selectedContestIds.size === 0} className="admin-button admin-button-small">
            <ArrowDownTrayIcon className="size-4" aria-hidden="true" />
            {isLoading ? t("Exporting…", "正在导出…") : t(`Export (${selectedContestIds.size})`, `导出（${selectedContestIds.size}）`)}
          </button>
        </div>
        <AdminTable label={t("Contest list", "比赛列表")} className="min-w-[22rem]">
          <thead>
            <tr>
              <th scope="col" className="w-11">
                <input type="checkbox" aria-label={t("Select contests on this page", "选择本页比赛")} checked={allOnPageSelected} onChange={selectAllContests} disabled={!contests.length} className="admin-checkbox" />
              </th>
              <th scope="col">{t("Contest", "比赛")}</th>
              <th scope="col" className="hidden lg:table-cell">{t("Schedule", "赛程")}</th>
              <th scope="col" className="min-w-40 text-right">{t("Actions", "操作")}</th>
            </tr>
          </thead>
          <tbody>
            {contests.map((contest) => {
              const duration = (contest.endTime.getTime() - contest.startTime.getTime()) / 3_600_000;
              const visibilityAction = contest.visible ? t("Hide from homepage", "从首页隐藏") : t("Show on homepage", "在首页显示");
              const date = dateFormat.format(contest.startTime);

              return (
                <tr key={contest.id}>
                  <td className="align-top">
                    <input type="checkbox" aria-label={t(`Select ${contest.title}`, `选择 ${contest.title}`)} checked={selectedContestIds.has(contest.id)} onChange={() => toggleContestSelection(contest.id)} className="admin-checkbox" />
                  </td>
                  <th scope="row" className="max-w-80 min-w-32 align-top font-normal">
                    <Link href={`/admin/contests/${contest.id}/edit`} className="admin-text-link block wrap-break-word font-semibold">{contest.title}</Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-mono text-gray-600">#{contest.id}</span>
                      <AdminContestStatus status={contest.status} lang={lang} />
                      <span className={contest.type === ContestType.PUBLIC ? "text-blue-700" : "text-yellow-700"}>
                        {contest.type === ContestType.PUBLIC ? t("Public", "公开") : t("Private", "私有")}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-600 lg:hidden">
                      <time dateTime={contest.startTime.toISOString()}>{date}</time>
                      {" · "}{duration.toLocaleString(locale, { maximumFractionDigits: 1 })} {t("h", "小时")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs tabular-nums text-gray-600">
                      <span className="inline-flex items-center gap-1" title={t("Problems", "题目")}><DocumentTextIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{t("Problems", "题目")}</span>{contest._count.problems}</span>
                      <span className="inline-flex items-center gap-1" title={t("Contest accounts", "比赛账号")}><UserGroupIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{t("Contest accounts", "比赛账号")}</span>{contest._count.users}</span>
                      <span className="inline-flex items-center gap-1" title={t("Submissions", "提交")}><PlayIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{t("Submissions", "提交")}</span>{contest._count.submissions}</span>
                    </div>
                  </th>
                  <td className="hidden align-top lg:table-cell">
                    <time className="text-sm" dateTime={contest.startTime.toISOString()}>{date}</time>
                    <div className="mt-1 text-xs text-gray-600">{duration.toLocaleString(locale, { maximumFractionDigits: 1 })} {t("h", "小时")}</div>
                  </td>
                  <td className="align-top">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Link href={`/admin/contests/${contest.id}/problems`} className="admin-button admin-button-small">{t("Problems", "题目")}</Link>
                      <Link href={`/admin/contests/${contest.id}/users`} className="admin-button admin-button-small">{t("Users", "账号")}</Link>
                      <Link href={`/admin/contests/${contest.id}/awards`} className="admin-button admin-button-small">
                        <TrophyIcon className="size-3.5 text-amber-700" aria-hidden="true" />
                        {t("Awards", "奖项")}
                      </Link>
                      <Link href={`/admin/contests/${contest.id}/edit`} className="admin-icon-button size-8" title={t("Edit contest", "编辑比赛")} aria-label={t("Edit contest", "编辑比赛")}>
                        <PencilSquareIcon className="size-4" aria-hidden="true" />
                      </Link>
                      <button type="button" onClick={() => handleVisibilityToggle(contest.id, contest.visible)} className="admin-icon-button size-8" title={visibilityAction} aria-label={visibilityAction}>
                        {contest.visible ? <EyeIcon className="size-4 text-green-600" aria-hidden="true" /> : <EyeSlashIcon className="size-4 text-gray-500" aria-hidden="true" />}
                      </button>
                      <DeleteContestButton contestId={contest.id} contestTitle={contest.title} onDeleted={handleContestDeleted} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {contests.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center">
                  <p role="status" className="py-7 text-sm text-gray-600">
                    {loadingContests ? t("Loading contests…", "正在加载比赛…") : loadFailed ? t("Could not load contests. Refresh to retry.", "无法加载比赛，请刷新后重试。") : t("No contests yet. Create or import one to get started.", "目前没有比赛。可以先创建或导入一场比赛。")}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </AdminTable>
        <div className="admin-table-footer">
          <Pagination totalItems={total} pageSize={pageSize} />
        </div>
      </section>
    </div>
  );
}
