"use client";

import CodeEditor from "@/components/CodeEditor";
import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { toast } from "sonner";

interface Props {
  code: string;
  language: string;
}

export default function CodeViewer({ code, language }: Props) {
  const { dict } = useLanguage();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(dict.common.copyFailed);
    }
  };

  return (
    <div className="border border-gray-200 rounded-sm overflow-hidden relative">
      <div className="bg-gray-800 text-white px-4 py-2 font-mono text-sm flex justify-between items-center">
        <span>{dict.common.code}</span>
        <button
          onClick={handleCopy}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors flex items-center gap-2"
        >
          {copied ? (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {dict.common.copied}
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {dict.common.copyCode}
            </>
          )}
        </button>
      </div>
      <CodeEditor
        value={code}
        language={language}
        height="600px"
        readOnly={true}
        wordWrap="off"
      />
    </div>
  );
}
