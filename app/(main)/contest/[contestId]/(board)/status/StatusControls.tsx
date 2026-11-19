"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

interface StatusControlsProps {
  canViewAll: boolean;
}

export default function StatusControls({
  canViewAll,
}: StatusControlsProps) {
  const router = useRouter();
  const { dict } = useLanguage();
  const searchParams = useSearchParams();
  const viewAll = searchParams.get("viewAll") === "true";

  const handleToggleViewAll = (checked: boolean) => {
    const params = new URLSearchParams(searchParams);
    params.set("viewAll", checked ? "true" : "false");
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-4">
      <label className="flex flex-wrap items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={viewAll && canViewAll}
          onChange={(e) => handleToggleViewAll(e.target.checked)}
          disabled={!canViewAll}
          className="w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-sm font-medium text-gray-700">
          {dict.submission.viewAll}
        </span>
        {!canViewAll && (
          <span className="text-xs text-gray-400">
            {dict.submission.afterContest}
          </span>
        )}
      </label>
    </div>
  );
}
