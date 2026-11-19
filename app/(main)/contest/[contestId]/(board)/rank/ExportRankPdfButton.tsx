"use client";

import { useLanguage } from "@/context/LanguageContext";

import { DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

interface Props {
  contestId: string;
}

export default function ExportRankPdfButton({ contestId }: Props) {
  const { dict: { rank } } = useLanguage();
  return (
    <Link
      href={`/contest/${contestId}/rank/print`}
      target="_blank"
      className="inline-flex items-center gap-1.5 rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      title={rank.printable}
      aria-label={rank.printable}
    >
      <DocumentArrowDownIcon className="w-4 h-4" />
      PDF
    </Link>
  );
}
