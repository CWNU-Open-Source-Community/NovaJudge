"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { adminSubmit, debugAllSamples } from "./actions";
import {
  PlayIcon,
  CheckCircleIcon,
  BeakerIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/solid";
import CodeBlock from "@/components/CodeBlock";
import CodeEditor from "@/components/CodeEditor";
import CommunicationSample from "@/components/CommunicationSample";
import { getCommunicationSampleDisplay, type ProblemSample } from "@/lib/problem-samples";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import "katex/dist/katex.min.css";
import type {
  DebugAllSamplesResult,
  SampleDebugResult,
  SampleDebugVerdict,
} from "@/lib/judge";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-lg font-bold text-blue-800 border-l-4 border-blue-600 pl-3 mb-3 font-serif tracking-wide">
    {children}
  </h3>
);

interface Section {
  title: string;
  content: string;
}

interface ProblemDetail {
  id: number;
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: Section[];
  samples: ProblemSample[];
  hint: string;
}

const VERDICT_STYLES: Record<
  SampleDebugVerdict,
  { label: string; className: string }
> = {
  AC: { label: "AC", className: "text-green-700 bg-green-50 border-green-200" },
  WA: { label: "WA", className: "text-red-700 bg-red-50 border-red-200" },
  PE: { label: "PE", className: "text-amber-700 bg-amber-50 border-amber-200" },
  TLE: {
    label: "TLE",
    className: "text-orange-700 bg-orange-50 border-orange-200",
  },
  MLE: {
    label: "MLE",
    className: "text-orange-700 bg-orange-50 border-orange-200",
  },
  RE: {
    label: "RE",
    className: "text-purple-700 bg-purple-50 border-purple-200",
  },
  CE: {
    label: "CE",
    className: "text-yellow-700 bg-yellow-50 border-yellow-200",
  },
  SE: { label: "SE", className: "text-gray-700 bg-gray-100 border-gray-200" },
};

function ResultCard({
  result,
  isCommunication,
}: {
  result: SampleDebugResult;
  isCommunication: boolean;
}) {
  const verdictStyle = VERDICT_STYLES[result.verdict];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">
            Sample {result.sampleIndex}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${verdictStyle.className}`}
          >
            {verdictStyle.label}
          </span>
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-3">
          <span>Time: {result.timeUsedMs ?? "-"} ms</span>
          <span>Memory: {result.memoryUsedKb ?? "-"} KB</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {isCommunication ? "第一轮实际输入" : "Input"}
          </p>
          <CodeBlock code={result.input} />
        </div>
        {(!isCommunication || result.expectedOutput) && <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {isCommunication ? "裁判参考答案（仅管理员可见）" : "Expected Output"}
          </p>
          <CodeBlock code={result.expectedOutput} />
        </div>}
        {isCommunication && result.communication && (
          <details className="rounded border border-blue-200 bg-blue-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-blue-900">
              实际通信过程
            </summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs text-gray-600">
                First run: {result.communication.firstTimeUsedMs} ms
                {" · "}
                Second run: {result.communication.secondTimeUsedMs} ms
              </p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  第一轮实际输出
                </p>
                <CodeBlock code={result.communication.firstOutput} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  裁判生成的第二轮实际输入
                </p>
                <CodeBlock code={result.communication.secondInput} />
              </div>
            </div>
          </details>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {isCommunication ? "第二轮实际输出" : "Actual Output"}
          </p>
          <CodeBlock code={result.actualOutput} />
        </div>
        {result.message && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              {isCommunication ? "Communicator Verdict / Diagnostics" : "Message"}
            </p>
            <CodeBlock code={result.message} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function TestInterface({ problem }: { problem: ProblemDetail }) {
  const isCommunication = problem.type === "communication";
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("cpp");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [debugResult, setDebugResult] = useState<DebugAllSamplesResult | null>(
    null,
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const cacheKey = `xcpc_admin_p${problem.id}_code`;
    const langKey = `xcpc_admin_p${problem.id}_lang`;

    const savedCode = localStorage.getItem(cacheKey);
    const savedLang = localStorage.getItem(langKey);

    if (savedCode !== null) setCode(savedCode);
    if (savedLang !== null) setLanguage(savedLang);

    setIsLoaded(true);
  }, [problem.id]);

  useEffect(() => {
    if (!isLoaded) return;

    const timer = setTimeout(() => {
      localStorage.setItem(`xcpc_admin_p${problem.id}_code`, code);
      localStorage.setItem(`xcpc_admin_p${problem.id}_lang`, language);
    }, 500);

    return () => clearTimeout(timer);
  }, [code, language, problem.id, isLoaded]);

  const handleSubmit = async () => {
    if (!code.trim()) {
      toast.error("Code cannot be empty");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await adminSubmit(problem.id, code, language);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.success) {
        setLastId(res.submissionId);
        toast.success("Submitted successfully!");
        router.push("/admin/submissions");
      }
    } catch (e) {
      toast.error("Submission failed: " + e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDebug = async () => {
    if (!code.trim()) {
      toast.error("Code cannot be empty");
      return;
    }

    setIsDebugging(true);
    try {
      const res = await debugAllSamples(problem.id, code, language);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.success) {
        setDebugResult(res.data);
        setIsDrawerOpen(true);
        if (res.data.compile.ok) {
          if (res.data.summary.total === 0) {
            toast.message(res.data.message || "No samples available");
          } else {
            toast.success(
              `Debug finished: ${res.data.summary.passed}/${res.data.summary.total} passed`,
            );
          }
        } else {
          toast.error(res.data.compile.message || "Debug failed");
        }
      }
    } catch (e) {
      toast.error("Debug failed: " + e);
    } finally {
      setIsDebugging(false);
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col lg:flex-row gap-4">
      <div className="flex-1 relative bg-white border border-gray-200 rounded-lg shadow-sm overflow-y-auto p-6 min-h-0">
        <div className="absolute inset-0 overflow-y-auto p-6">
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-8 text-center border-b pb-4">
            {problem.title}
          </h1>

          {isCommunication && (
            <div className="mb-6 space-y-2 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-semibold">通信题 / Communication (Run twice)</p>
              <p>
                The same program runs twice with separate time and memory
                limits and no shared memory or files. Follow the statement for
                the permitted message and each run&apos;s input and output.
              </p>
              <p>
                下方每个样例成对展示两次运行，输入中的 first / second 是题目约定的运行标识。
                调试使用第一轮输入，由上传的通信裁判根据程序实际输出生成第二轮输入。
                题面示例只展示一种合法通信方案，不作为固定输出进行比对。
              </p>
            </div>
          )}

          <div className="space-y-8">
            {problem.sections.map((section: Section, index: number) => (
              <div key={`section-${index}`}>
                <SectionTitle>{section.title}</SectionTitle>
                <article className="prose prose-sm md:prose-base max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-pre:bg-gray-100 prose-pre:text-gray-800">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                  >
                    {section.content}
                  </ReactMarkdown>
                </article>
              </div>
            ))}
            {problem.samples.map((sample: ProblemSample, index: number) => {
              const suffix = problem.samples.length > 1 ? ` ${index + 1}` : "";

              if (isCommunication) {
                return (
                  <div key={`sample-${index}`} className="space-y-4">
                    <CommunicationSample
                      {...getCommunicationSampleDisplay(sample)}
                      index={problem.samples.length > 1 ? index + 1 : undefined}
                    />
                    {sample.output && (
                      <details className="rounded border border-gray-200 bg-gray-50 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-gray-600">
                          裁判参考答案（仅管理员可见）
                        </summary>
                        <div className="mt-3"><CodeBlock code={sample.output} /></div>
                      </details>
                    )}
                  </div>
                );
              }

              return (
                <div key={`sample-${index}`} className="grid grid-cols-1 gap-6">
                  <div>
                    <SectionTitle>
                      Sample Input
                      {suffix}
                    </SectionTitle>
                    <CodeBlock code={sample.input} />
                  </div>
                  <div>
                    <SectionTitle>
                      Sample Output
                      {suffix}
                    </SectionTitle>
                    <CodeBlock code={sample.output} />
                  </div>
                </div>
              );
            })}
            {problem.hint && (
              <div>
                <SectionTitle>Hint</SectionTitle>
                <article className="prose prose-sm md:prose-base max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                  >
                    {problem.hint}
                  </ReactMarkdown>
                </article>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden min-h-0">
        <div className="bg-gray-50 border-b px-4 py-2 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-700">Code Editor</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-sm border-gray-300 rounded shadow-sm py-1 px-2"
            >
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="pypy3">PyPy3</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDebug}
              disabled={isDebugging}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {isDebugging ? (
                "Debugging..."
              ) : (
                <>
                  <BeakerIcon className="w-4 h-4" /> Debug All Samples
                </>
              )}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                "Submitting..."
              ) : (
                <>
                  <PlayIcon className="w-4 h-4" /> Submit
                </>
              )}
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 bg-white">
          <div
            className={`absolute inset-x-0 top-0 p-3 transition-[bottom] duration-300 ease-out ${
              isDrawerOpen ? "bottom-88 md:bottom-96" : "bottom-14"
            }`}
          >
            <CodeEditor
              value={code}
              language={language}
              onChange={setCode}
              height="100%"
            />
          </div>

          <div
            className={`absolute inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-gray-50/95 backdrop-blur transition-transform duration-300 ease-out ${
              isDrawerOpen ? "translate-y-0" : "translate-y-[calc(100%-3.5rem)]"
            }`}
          >
            <button
              type="button"
              onClick={() => setIsDrawerOpen((open) => !open)}
              className="w-full px-4 py-3 border-b border-gray-200 bg-white/90 hover:bg-white transition-colors"
            >
              <div className="mx-auto mb-2 h-1.5 w-14 rounded-full bg-gray-300" />
              <div className="flex items-center justify-between gap-3">
                <div className="text-left">
                  <h2 className="text-sm font-bold text-gray-800">
                    Sample Debug Results
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Click to {isDrawerOpen ? "hide" : "show"} per-sample outputs
                    and verdicts.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {debugResult && debugResult.compile.ok && (
                    <div className="text-sm font-semibold text-gray-700">
                      Passed {debugResult.summary.passed}/
                      {debugResult.summary.total}
                    </div>
                  )}
                  {isDrawerOpen ? (
                    <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                  )}
                </div>
              </div>
            </button>

            <div className="h-88 overflow-y-auto p-4 md:h-96">
              <div className="space-y-4">
                {!debugResult && (
                  <div className="border border-dashed border-gray-300 rounded-lg bg-white px-4 py-8 text-center text-sm text-gray-500">
                    Click{" "}
                    <span className="font-semibold">Debug All Samples</span> to
                    see per-sample outputs and verdicts here.
                  </div>
                )}

                {debugResult && !debugResult.compile.ok && (
                  <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                    <p className="text-sm font-semibold text-red-700 mb-2">
                      Compile / Debug Error
                    </p>
                    <CodeBlock
                      code={debugResult.compile.message || "Unknown error"}
                    />
                  </div>
                )}

                {debugResult?.compile.ok && debugResult.message && (
                  <div className="border border-gray-200 bg-white rounded-lg px-4 py-3 text-sm text-gray-600">
                    {debugResult.message}
                  </div>
                )}

                {debugResult?.compile.ok &&
                  debugResult.results.map((result) => (
                    <ResultCard
                      key={result.sampleIndex}
                      result={result}
                      isCommunication={isCommunication}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>

        {lastId && (
          <div className="bg-green-50 text-green-700 text-xs px-4 py-2 border-t border-green-100 flex items-center">
            <CheckCircleIcon className="w-4 h-4 mr-1" />
            Last Submission: {lastId} (Check Global Submissions for result)
          </div>
        )}
      </div>
    </div>
  );
}
