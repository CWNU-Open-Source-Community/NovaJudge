"use client";

import { useLanguage } from "@/context/LanguageContext";

export default function PrintAgainButton() {
  const { dict } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-4 py-2 rounded-sm bg-slate-800 text-white text-sm font-bold"
    >
      {dict.print.printAgain}
    </button>
  );
}
