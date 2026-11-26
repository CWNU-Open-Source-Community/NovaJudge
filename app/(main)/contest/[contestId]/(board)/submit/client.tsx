"use client";

import { useEffect, useState } from "react";
import CodeEditor from "@/components/CodeEditor";
import { submitCode } from "./actions";
import { useLanguage } from "@/context/LanguageContext";
import { toast } from "sonner";
import { formatMessage } from "@/lib/dictionaries";
import { contestLanguages } from "@/lib/contest-languages";

export default function SubmitForm({
  contestId,
  problemId,
  isAdmin,
}: {
  contestId: string;
  problemId: string;
  isAdmin: boolean;
}) {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("cpp");
  const { dict } = useLanguage();

  const [isLoaded, setIsLoaded] = useState(false);

  // 1. 初始化时读取缓存（根据 Contest ID 和 Problem Display ID）
  useEffect(() => {
    // 基础键，用于在不看代码时记忆上次选的语言
    const lastLangKey = `xcpc_c${contestId}_p${problemId}_last_lang`;

    // 如果是第一次加载页面，先恢复上次选的语言
    if (!isLoaded) {
      const savedLastLang = localStorage.getItem(lastLangKey);
      if (savedLastLang) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLanguage(savedLastLang);
        setIsLoaded(true);
        return;
      }
      setIsLoaded(true);
    }

    const codeKey = `xcpc_c${contestId}_p${problemId}_code_${language}`;
    const savedCode = localStorage.getItem(codeKey);

    if (savedCode !== null) {
      setCode(savedCode);
    } else {
      setCode("");
    }
  }, [contestId, problemId, language, isLoaded]);

  // 2. 代码变化时写入当前语言的缓存
  useEffect(() => {
    if (!isLoaded) return;

    const codeKey = `xcpc_c${contestId}_p${problemId}_code_${language}`;
    const lastLangKey = `xcpc_c${contestId}_p${problemId}_last_lang`;

    const timer = setTimeout(() => {
      localStorage.setItem(codeKey, code);
      localStorage.setItem(lastLangKey, language);
    }, 500);

    return () => clearTimeout(timer);
  }, [code, language, contestId, problemId, isLoaded]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await submitCode(Number(contestId), problemId, language, code);
    if (res?.error) {
      toast.error(dict.submissionErrors[res.error]);
    }
  };

  return (
    <main className="flex-1 w-full min-w-0">
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-6 border-b border-slate-200 pb-4">
          {dict.submit.title}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              {dict.common.language}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 max-w-xs"
            >
              {contestLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              {dict.common.code}
            </label>
            <div className="relative">
              <CodeEditor
                value={code}
                language={language}
                onChange={setCode}
                height="500px"
              />
              <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                {formatMessage(dict.submit.characterCount, { count: code.length })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin ? (
              <button
                disabled
                className="bg-slate-400 text-white font-medium rounded-xl text-sm px-8 py-3 shadow-sm cursor-not-allowed opacity-60"
                title={dict.submit.unavailable}
              >
                {dict.common.submit}
              </button>
            ) : (
              <button
                type="submit"
                className="text-white bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 font-semibold rounded-xl text-sm px-8 py-3 shadow-md shadow-blue-600/20 transition active:scale-95"
              >
                {dict.common.submit}
              </button>
            )}

            <button
              type="button"
              onClick={() => setCode("")}
              className="text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium rounded-xl text-sm px-6 py-3 transition-colors"
            >
              {dict.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
