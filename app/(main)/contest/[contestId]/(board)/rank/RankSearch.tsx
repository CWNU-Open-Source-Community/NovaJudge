"use client";

import { useLanguage } from "@/context/LanguageContext";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { faFilter } from "@fortawesome/free-solid-svg-icons";
import DomjudgeIcon from "@/components/contest/DomjudgeIcon";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";

interface RankSearchProps {
  schools: string[];
  categories: string[];
}

export default function RankSearch({ schools, categories }: RankSearchProps) {
  const router = useRouter();
  const { dict: { rank, common } } = useLanguage();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(
    searchParams.get("teamName") || ""
  );
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentTeamName = searchParams.get("teamName") || "";
  const currentSchool = searchParams.get("school") || "";
  const currentCategory = searchParams.get("category") || "";

  const categoryMap: Record<string, string> = {
    0: rank.officialTeam,
    1: rank.unofficialTeam,
    2: rank.womenTeam,
  };

  // 防抖搜索队伍名
  const handleTeamNameChange = (value: string) => {
    setInputValue(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("teamName", value);
      } else {
        params.delete("teamName");
      }
      params.set("page", "1");
      router.push(`?${params.toString()}`);
    }, 500);
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

  const hasActiveFilters = currentTeamName || currentSchool || currentCategory;

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
    setInputValue(currentTeamName);
  }, [currentTeamName]);

  return (
    <Popover className="relative order-first md:order-last">
      <PopoverButton className="dj-filter-toggle">
        <DomjudgeIcon icon={faFilter} />
        <span className="md:hidden">{common.filter}</span>
        <span className="hidden md:inline">{common.search}</span>
        {hasActiveFilters && " ✓"}
      </PopoverButton>

      <PopoverPanel className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-md border border-gray-200 bg-white p-4 shadow-lg md:right-0 md:left-auto">
        {/* 队伍名搜索 */}
        <div>
          <label htmlFor="rank-filter-team" className="block text-sm font-medium text-gray-700 mb-2">
            {common.teamName}
          </label>
          <input
            id="rank-filter-team"
            type="text"
            value={inputValue}
            onChange={(e) => handleTeamNameChange(e.target.value)}
            placeholder={rank.searchTeam}
            aria-label={rank.searchTeam}
            className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 学校筛选 */}
        <div>
          <label htmlFor="rank-filter-school" className="block text-sm font-medium text-gray-700 mb-2">
            {common.school}
          </label>
          <select
            id="rank-filter-school"
            value={currentSchool}
            onChange={(e) => handleFilterChange("school", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{rank.allSchools}</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* 队伍类型筛选 */}
        <div>
          <label htmlFor="rank-filter-category" className="block text-sm font-medium text-gray-700 mb-2">
            {common.category}
          </label>
          <select
            id="rank-filter-category"
            value={currentCategory}
            onChange={(e) => handleFilterChange("category", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{rank.allCategories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryMap[c] || c}
              </option>
            ))}
          </select>
        </div>

        {/* 重置按钮 */}
        {hasActiveFilters && (
          <button
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              params.delete("teamName");
              params.delete("school");
              params.delete("category");
              params.set("page", "1");
              router.push(`?${params.toString()}`);
            }}
            className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-sm hover:bg-gray-200 transition-colors"
          >
            {common.clearFilters}
          </button>
        )}
      </PopoverPanel>
    </Popover>
  );
}
