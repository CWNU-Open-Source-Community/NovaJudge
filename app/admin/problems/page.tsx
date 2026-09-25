'use client';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProblems } from "./actions";
import {
  PencilSquareIcon,
  ServerStackIcon,
  BeakerIcon,
  PlayCircleIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";
import Pagination from "@/components/Pagination";
import RejudgeButton from "./RejudgeProblemButton";
import DeleteProblemButton from "./DeleteProblemButton";
import { toast } from "sonner";

export default function ProblemsPage() {
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

  async function loadProblems(page: number) {
    const { problems: loadedProblems, total: loadedTotal } = await getProblems(page);
    setProblems(loadedProblems);
    setTotal(loadedTotal);
    setSelectedProblemIds(new Set());
  }

  useEffect(() => {
    loadProblems(currentPage);
  }, [currentPage]);

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
      toast.error("Please select at least one problem to export");
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

      toast.success(`Successfully exported ${selectedProblemIds.size} problems`);
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Problem Bank</h1>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            disabled={isLoading || selectedProblemIds.size === 0}
            className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 transition flex items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <PlayCircleIcon className="w-4 h-4" />
            Export ({selectedProblemIds.size})
          </button>
          <Link
            href="/admin/problems/import"
            className="bg-purple-600 text-white px-4 py-2 rounded shadow hover:bg-purple-700 transition flex items-center gap-2"
          >
            <PlayIcon className="w-4 h-4" />
            Import
          </Link>
          <Link
            href="/admin/problems/create"
            className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition"
          >
            + Create Problem
          </Link>
        </div>
      </div>

      <div className="bg-white shadow rounded overflow-hidden">
        <table className="w-full text-sm text-left text-gray-600">
          <thead className="bg-gray-50 text-gray-700 font-bold border-b">
            <tr>
              <th className="px-6 py-3 w-12">
                <input
                  type="checkbox"
                  checked={problems.length > 0 && selectedProblemIds.size === problems.length}
                  onChange={selectAllProblems}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-6 py-3 w-20">ID</th>
              <th className="px-6 py-3">Title</th>
              <th className="px-6 py-3 w-48">Type</th>
              <th className="px-6 py-3 w-48">Updated At</th>
              <th className="px-6 py-3 w-32 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {problems.map((problem) => (
              <tr key={problem.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <input
                    type="checkbox"
                    checked={selectedProblemIds.has(problem.id)}
                    onChange={() => toggleProblemSelection(problem.id)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="px-6 py-4 font-mono">#{problem.id}</td>
                <td className="px-6 py-4 font-medium text-gray-900">
                  <Link
                    href={`/admin/problems/${problem.id}/test`}
                    className="cursor-pointer"
                    title="Test Problem"
                  >
                    {problem.title}
                  </Link>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      problem.type === "spj"
                        ? "bg-purple-100 text-purple-700"
                        : problem.type === "communication"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {problem.type === "communication"
                      ? "Communication (Run twice)"
                      : problem.type}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {new Date(problem.updatedAt).toLocaleString()}
                </td>
                <td className="px-6 py-4 flex justify-center items-center gap-3">
                  <Link
                    href={`/admin/problems/${problem.id}/test`}
                    className="text-orange-500 hover:text-orange-700"
                    title="Test Problem"
                  >
                    <BeakerIcon className="w-5 h-5" />
                  </Link>
                  <Link
                    href={`/admin/problems/${problem.id}/data`}
                    className="text-purple-600 hover:text-purple-800"
                    title="Manage Data & Config"
                  >
                    <ServerStackIcon className="w-5 h-5" />
                  </Link>
                  <Link
                    href={`/admin/problems/${problem.id}`}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                  </Link>
                  <RejudgeButton problemId={problem.id} />
                  <DeleteProblemButton problemId={problem.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Pagination totalItems={total} />
      </div>
    </div>
  );
}
