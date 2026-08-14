"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getContests, toggleContestVisibility } from "./actions";
import Pagination from "@/components/Pagination";
import DeleteContestButton from "./DeleteContestButton";
import {
  PlusIcon,
  UserGroupIcon,
  DocumentTextIcon,
  PlusCircleIcon,
  PlayIcon,
  EyeIcon,
  EyeSlashIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { ContestStatus, ContestType } from "@/lib/generated/prisma/enums";
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
  const [contests, setContests] = useState<Contest[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedContestIds, setSelectedContestIds] = useState<Set<number>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [includeData, setIncludeData] = useState(true);
  const pageSize = 15;

  useEffect(() => {
    const loadContests = async () => {
      const { page } = await searchParams;
      const pageNum = Number(page) || 1;
      const { contests: loadedContests, total: loadedTotal } =
        await getContests(pageNum, pageSize);
      setContests(loadedContests);
      setTotal(loadedTotal);
    };

    loadContests();
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
    if (selectedContestIds.size === contests.length) {
      setSelectedContestIds(new Set());
    } else {
      setSelectedContestIds(new Set(contests.map((c) => c.id)));
    }
  }

  async function handleExport() {
    if (selectedContestIds.size === 0) {
      toast.error("Please select at least one contest to export");
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
        `Successfully exported ${selectedContestIds.size} contests`,
      );
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVisibilityToggle(id: number, currentVisible: boolean) {
    try {
      await toggleContestVisibility(id, !currentVisible);
      setContests(
        contests.map((c) =>
          c.id === id ? { ...c, visible: !currentVisible } : c,
        ),
      );
      toast.success(`Contest is now ${!currentVisible ? "visible" : "hidden"}`);
    } catch {
      toast.error("Failed to update visibility");
    }
  }

  function handleContestDeleted(id: number) {
    setContests(contests.filter((contest) => contest.id !== id));
    setSelectedContestIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setTotal((current) => Math.max(0, current - 1));
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Contest Management</h1>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeData}
              onChange={(e) => setIncludeData(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500"
            />
            Include Test Data
          </label>
          <button
            onClick={handleExport}
            disabled={isLoading || selectedContestIds.size === 0}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <PlusCircleIcon className="w-5 h-5" />
            Export ({selectedContestIds.size})
          </button>
          <Link
            href="/admin/contests/import"
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors"
          >
            <PlayIcon className="w-5 h-5" />
            Import
          </Link>
          <Link
            href="/admin/contests/create"
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            Create Contest
          </Link>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="bg-gray-50 text-gray-700 font-bold border-b uppercase text-xs">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={
                      contests.length > 0 &&
                      selectedContestIds.size === contests.length
                    }
                    onChange={selectAllContests}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-3 py-3">ID</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Visibility</th>
                <th className="px-3 py-3">Start Time</th>
                <th className="px-3 py-3">Stats</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contests.map((contest) => {
                const durationHours = (
                  (contest.endTime.getTime() - contest.startTime.getTime()) /
                  1000 /
                  3600
                ).toFixed(1);

                // 计算状态颜色
                let statusColor = "bg-gray-100 text-gray-800";
                if (contest.status === ContestStatus.RUNNING)
                  statusColor = "bg-green-100 text-green-800";
                if (contest.status === ContestStatus.ENDED)
                  statusColor = "bg-red-100 text-red-800";

                return (
                  <tr key={contest.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedContestIds.has(contest.id)}
                        onChange={() => toggleContestSelection(contest.id)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {contest.id}
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-900 max-w-[170px] truncate" title={contest.title}>
                      {contest.title}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}
                      >
                        {contest.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`whitespace-nowrap px-2 py-0.5 rounded text-xs border ${
                          contest.type === ContestType.PUBLIC
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-yellow-200 bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {contest.type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        className="cursor-pointer"
                        onClick={() =>
                          handleVisibilityToggle(contest.id, contest.visible)
                        }
                        title={
                          contest.visible
                            ? "Hide from homepage"
                            : "Show on homepage"
                        }
                      >
                        {contest.visible ? (
                          <EyeIcon className="w-5 h-5 text-green-600" />
                        ) : (
                          <EyeSlashIcon className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {new Date(contest.startTime).toLocaleString()}
                      <span className="text-xs text-gray-400 ml-1">
                        ({durationHours}h)
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-3 text-gray-400">
                        <span
                          className="flex items-center gap-1"
                          title="Problems"
                        >
                          <DocumentTextIcon className="w-4 h-4" />
                          {contest._count.problems}
                        </span>
                        <span className="flex items-center gap-1" title="Teams">
                          <UserGroupIcon className="w-4 h-4" />
                          {contest._count.users}
                        </span>
                        <span
                          className="flex items-center gap-1"
                          title="Submissions"
                        >
                          <PlayIcon className="w-4 h-4" />
                          {contest._count.submissions}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/admin/contests/${contest.id}/problems`}
                          className="whitespace-nowrap text-xs font-bold border border-gray-300 text-gray-700 px-2.5 py-1 rounded-md hover:bg-white hover:border-blue-500 hover:text-blue-600 transition-all shadow-sm bg-gray-50"
                        >
                          Problems
                        </Link>
                        <Link
                          href={`/admin/contests/${contest.id}/users`}
                          className="whitespace-nowrap text-xs font-bold border border-gray-300 text-gray-700 px-2.5 py-1 rounded-md hover:bg-white hover:border-purple-500 hover:text-purple-600 transition-all shadow-sm bg-gray-50"
                        >
                          Users
                        </Link>
                        <Link
                          href={`/admin/contests/${contest.id}/awards`}
                          className="whitespace-nowrap text-xs font-bold border border-amber-300 text-amber-700 px-2.5 py-1 rounded-md hover:bg-white hover:border-amber-500 hover:text-amber-600 transition-all shadow-sm bg-amber-50"
                          title="快速设置奖项并导出含奖项的 Event Feed"
                        >
                          <span className="inline-flex items-center gap-1">
                            <TrophyIcon className="w-3.5 h-3.5" />
                            Awards
                          </span>
                        </Link>
                        <Link
                          href={`/admin/contests/${contest.id}/edit`}
                          className="whitespace-nowrap text-xs font-bold text-gray-400 hover:text-gray-600 px-2 py-1"
                        >
                          Settings
                        </Link>
                        <DeleteContestButton
                          contestId={contest.id}
                          contestTitle={contest.title}
                          onDeleted={handleContestDeleted}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {contests.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-8 text-center text-gray-400 italic"
                  >
                    No contests found. Create one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <Pagination totalItems={total} pageSize={pageSize} />
        </div>
      </div>
    </div>
  );
}
