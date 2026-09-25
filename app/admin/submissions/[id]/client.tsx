"use client";

import Link from "next/link";
import CodeEditor from "@/components/CodeEditor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import {
  ArrowLeftIcon,
  UserCircleIcon,
  CalendarIcon,
  ClockIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import CodeBlock from "@/components/CodeBlock";
import CommunicationSample from "@/components/CommunicationSample";
import {
  getCommunicationSampleDisplay,
  type ProblemSample,
} from "@/lib/problem-samples";
import { Prisma } from "@/lib/generated/prisma/client";
import LiveVerdict from "@/components/LiveVerdict";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const submissionWithRelations = {
  include: {
    user: { select: { username: true } },
    globalUser: { select: { username: true } },
    problem: true,
  },
} satisfies Prisma.SubmissionDefaultArgs;

// 生成类型（保持不变）
type SubmissionDetailType = Prisma.SubmissionGetPayload<
  typeof submissionWithRelations
>;

interface Props {
  submission: SubmissionDetailType;
  problem: ProblemDetail;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-lg font-bold text-blue-800 border-l-4 border-blue-600 pl-3 mb-3 font-serif tracking-wide">
    {children}
  </h3>
);

export default function SubmissionDetailClient({ submission, problem }: Props) {
  const submitter =
    submission.user?.username || submission.globalUser?.username || "Unknown";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* 顶部 Header */}
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/submissions"
            className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm font-medium"
          >
            <ArrowLeftIcon className="w-4 h-4" /> Back
          </Link>
          <div className="h-4 w-px bg-gray-300"></div>
          <h1 className="text-lg font-bold text-gray-800">
            Submission{" "}
            <span className="font-mono text-gray-500 text-base">
              #{submission.id.slice(0, 8)}
            </span>
          </h1>
          <LiveVerdict
            submissionId={submission.id}
            initialStatus={submission.verdict}
            initialPassed={submission.passedTests}
            initialTotal={submission.totalTests}
          />
        </div>

        <div className="flex items-center gap-6 text-sm text-gray-600">
          <div className="flex items-center gap-1.5" title="Submitter">
            <UserCircleIcon className="w-4 h-4" />
            <span className="font-medium">{submitter}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Time Used">
            <ClockIcon className="w-4 h-4" />
            <span>{submission.timeUsed} ms</span>
          </div>
          <div className="flex items-center gap-1.5" title="Memory Used">
            <CpuChipIcon className="w-4 h-4" />
            <span>{submission.memoryUsed} KB</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <CalendarIcon className="w-4 h-4" />
            <span>{new Date(submission.submittedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 核心内容区：分屏布局 */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* 左侧：题面 (50%) */}
        <div className="flex-1 bg-white border border-gray-200 rounded-lg shadow-sm overflow-y-auto p-6">
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-8 text-center border-b pb-4">
            {problem.title}
          </h1>

          <div className="space-y-8">
            {/* 1. 渲染常规文本段落 (Description, Input, Output) */}
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
            {/* 2. 渲染样例数组 */}
            {problem.samples.map((sample, index) => {
              if (problem.type === "communication") {
                return (
                  <CommunicationSample
                    key={`sample-${index}`}
                    {...getCommunicationSampleDisplay(sample)}
                    index={problem.samples.length > 1 ? index + 1 : undefined}
                  />
                );
              }

              // 如果只有一组样例，标题不显示序号；如果有多组，显示 1, 2, 3...
              const suffix = problem.samples.length > 1 ? ` ${index + 1}` : "";

              return (
                <div key={`sample-${index}`} className="grid grid-cols-1 gap-6">
                  <div>
                    <SectionTitle>Sample Input{suffix}</SectionTitle>
                    <CodeBlock code={sample.input} />
                  </div>
                  <div>
                    <SectionTitle>Sample Output{suffix}</SectionTitle>
                    <CodeBlock code={sample.output} />
                  </div>
                </div>
              );
            })}
            {/* 3. 渲染 Hint (如果有) */}
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

        {/* 右侧：代码 (50%) */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="px-4 py-2 border-b bg-gray-50 text-xs font-mono text-gray-500 flex justify-between">
            <span>Language: {submission.language}</span>
            <span>Length: {submission.codeLength} Bytes</span>
          </div>
          <div className="flex-1 min-h-0 relative">
            <CodeEditor
              value={submission.code}
              language={submission.language}
              readOnly={true} // 开启只读
              height="100%"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
