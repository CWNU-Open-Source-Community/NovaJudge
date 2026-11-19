"use client";

import { useLanguage } from "@/context/LanguageContext";

import { useRouter, useSearchParams } from "next/navigation";

export default function IncludeVpToggle({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) {
  const router = useRouter();
  const { dict: { rank } } = useLanguage();
  const searchParams = useSearchParams();
  const checked = searchParams.has("includeVp")
    ? searchParams.get("includeVp") !== "0"
    : defaultChecked;

  const handleChange = (nextChecked: boolean) => {
    const params = new URLSearchParams(searchParams);
    params.set("includeVp", nextChecked ? "1" : "0");
    router.push(`?${params.toString()}`);
  };

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => handleChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
      />
      <span>{rank.includeVp}</span>
    </label>
  );
}
