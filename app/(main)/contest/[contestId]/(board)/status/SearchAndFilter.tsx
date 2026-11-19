"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { getVerdictLabel } from "@/lib/dictionaries";

interface SearchAndFilterProps {
  canSearch: boolean;
  problems: Array<{ displayId: string; problemId: number }>;
  languages: string[];
  verdicts: string[];
  languageRecord: Record<string, string>;
}

export default function SearchAndFilter({
  canSearch,
  problems,
  languages,
  verdicts,
  languageRecord,
}: SearchAndFilterProps) {
  const router = useRouter();
  const { dict } = useLanguage();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(
    searchParams.get("userSearch") || ""
  );
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentUserSearch = searchParams.get("userSearch") || "";
  const currentProblem = searchParams.get("problem") || "";
  const currentLanguage = searchParams.get("language") || "";
  const currentVerdict = searchParams.get("verdict") || "";

  // 防抖搜索
  const handleSearchInput = (value: string) => {
    setInputValue(value);

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 设置新的定时器
    debounceTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("userSearch", value);
      } else {
        params.delete("userSearch");
      }
      params.set("page", "1");
      router.push(`?${params.toString()}`);
    }, 500); // 500ms 防抖延迟
  };

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const hasActiveFilters = currentProblem || currentLanguage || currentVerdict;

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // 同步 URL 参数到输入框
  useEffect(() => {
    setInputValue(currentUserSearch);
  }, [currentUserSearch]);

  return (
    <div className="flex w-full flex-wrap items-start gap-3 sm:w-auto sm:items-center">
      {/* 用户搜索框 */}
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <input
          type="text"
          placeholder={dict.submission.searchUser}
          aria-label={dict.submission.searchUser}
          value={inputValue}
          onChange={(e) => handleSearchInput(e.target.value)}
          disabled={!canSearch}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed sm:w-48"
        />
        {!canSearch && (
          <div className="absolute top-full mt-1 text-xs text-gray-400 whitespace-nowrap">
            {dict.submission.afterContest}
          </div>
        )}
      </div>

      {/* 筛选按钮和下拉菜单 */}
      <div className="relative shrink-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className={`px-3 py-2 text-sm font-medium rounded-sm border transition-colors ${
            hasActiveFilters
              ? "bg-blue-100 border-blue-300 text-blue-700"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          } cursor-pointer`}
        >
          {dict.common.filter} {hasActiveFilters && "✓"}
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full z-10 mt-2 w-[calc(100vw-1.5rem)] max-w-80 bg-white border border-gray-200 rounded-sm shadow-lg p-4 space-y-4">
            {/* Problem 筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {dict.submission.problem}
              </label>
              <select
                value={currentProblem}
                onChange={(e) => handleFilterChange("problem", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{dict.submission.allProblems}</option>
                {problems.map((p) => (
                  <option key={p.problemId} value={p.displayId}>
                    {p.displayId}
                  </option>
                ))}
              </select>
            </div>

            {/* Language 筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {dict.common.language}
              </label>
              <select
                value={currentLanguage}
                onChange={(e) => handleFilterChange("language", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{dict.submission.allLanguages}</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {languageRecord[lang] || lang}
                  </option>
                ))}
              </select>
            </div>

            {/* Verdict 筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {dict.submission.status}
              </label>
              <select
                value={currentVerdict}
                onChange={(e) => handleFilterChange("verdict", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{dict.submission.allVerdicts}</option>
                {verdicts.map((verdict) => (
                  <option key={verdict} value={verdict}>
                    {getVerdictLabel(verdict)}
                  </option>
                ))}
              </select>
            </div>

            {/* 重置按钮 */}
            {hasActiveFilters && (
              <button
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.delete("problem");
                  params.delete("language");
                  params.delete("verdict");
                  params.set("page", "1");
                  router.push(`?${params.toString()}`);
                }}
                className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-sm hover:bg-gray-200 transition-colors"
              >
                {dict.common.clearFilters}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
