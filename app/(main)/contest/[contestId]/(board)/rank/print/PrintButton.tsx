"use client";

import { useLanguage } from "@/context/LanguageContext";

export default function PrintButton() {
  const { dict: { rank } } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
    >
      {rank.printPdf}
    </button>
  );
}
