import { requireContestAccess } from "@/lib/contest-access";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax/svg";
import rehypeRaw from "rehype-raw";
import Link from "next/link";
import CodeBlock from "@/components/CodeBlock";
import CommunicationSample from "@/components/CommunicationSample";
import ProblemInfoCard from "@/components/ProblemInfoCard";
import ProblemAnswerSheet from "@/components/contest/ProblemAnswerSheet";
import {
  getCommunicationSampleDisplay,
  getPublicProblemSamples,
  type ProblemSample,
} from "@/lib/problem-samples";
import { prisma } from "@/lib/prisma";
import {
  ContestRole,
  ContestStatus,
  Verdict,
} from "@/lib/generated/prisma/client";
import { notFound } from "next/navigation";
import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { getDictionary } from "@/lib/get-dictionary";
import { Metadata } from "next";
import {
  getLatestVirtualParticipation,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";
import { problemColorStyle } from "@/lib/problem-badge";
import { ClockIcon, CpuChipIcon } from "@heroicons/react/24/outline";

type StatementSection = { title: string; content: string };

interface Props {
  params: Promise<{
    contestId: string;
    problemId: string;
  }>;
}
// 提取公共样式：标题样式 (蓝色竖线)
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-3 flex items-center gap-2.5 text-lg font-bold tracking-wide text-slate-900">
    <span aria-hidden="true" className="h-5 w-1 rounded-full bg-linear-to-b from-blue-500 to-indigo-500" />
    {children}
  </h3>
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
  await requireContestAccess(contestId);
  const displayId = (await params).problemId; // 比如 "A"

  // 1. 去数据库查这道题叫什么名字
  const contestProblem = await prisma.contestProblem.findFirst({
    where: {
      contestId: contestId,
      displayId: displayId,
    },
    include: {
      problem: true,
    },
  });

  if (!contestProblem) {
    return {
      title: (await getDictionary()).problemDetail.notFound,
    };
  }
  return {
    title: `${displayId} - ${contestProblem.problem.title}`,
    generator: "NovaJudge",
  };
}

export default async function ProblemDetail({ params }: Props) {
  const { contestId, problemId } = await params;
  const cid = Number(contestId);
  await requireContestAccess(cid);

  if (isNaN(cid)) return notFound();

  const contestProblem = await prisma.contestProblem.findFirst({
    where: {
      contestId: cid,
      displayId: problemId,
    },
    include: {
      problem: true,
      contest: true,
    },
  });

  if (!contestProblem) notFound();

  // 1. 鉴权逻辑：必须登录比赛账号或全局管理员
  const user = await getCurrentUser();
  const globalUser = await getCurrentSuper();
  const userPayload = user as UserJwtPayload | null;
  const globalUserId = (globalUser as unknown as UserJwtPayload)?.userId;
  const runningVp =
    !userPayload?.userId && globalUserId
      ? await getRunningVirtualParticipation(cid, String(globalUserId))
      : null;
  const latestVp =
    !userPayload?.userId && globalUserId
      ? await getLatestVirtualParticipation(cid, String(globalUserId))
      : null;

  const problem = contestProblem.problem;

  if (!problem || contestProblem.contest.status === ContestStatus.PENDING)
    notFound();

  // 2. 封榜统计逻辑
  const config = contestProblem.contest.config as {
    frozenDuration?: number;
  } | null;
  const frozenDuration = config?.frozenDuration ?? 0;
  let officialVisibleUntil = contestProblem.contest.endTime;
  let officialUpperBoundExclusive = false;

  if (frozenDuration > 0) {
    officialVisibleUntil = new Date(
      contestProblem.contest.endTime.getTime() -
        frozenDuration * 60 * 1000,
    );
    officialUpperBoundExclusive = true;
  }

  if (runningVp) {
    const now = new Date();
    officialVisibleUntil = new Date(
      Math.min(
        contestProblem.contest.startTime.getTime() +
          (now.getTime() - runningVp.startedAt.getTime()),
        contestProblem.contest.endTime.getTime(),
      ),
    );
    officialUpperBoundExclusive = false;
  }

  const officialWhere = getOfficialSubmissionWhere({
    contestId: cid,
    startTime: contestProblem.contest.startTime,
    endTime: contestProblem.contest.endTime,
    visibleUntil: officialVisibleUntil,
    exclusiveUpperBound: officialUpperBoundExclusive,
  });

  const [officialTotalStats, officialAcStats, vpTotalStats, vpAcStats] =
    await Promise.all([
      prisma.submission.count({
        where: {
          ...officialWhere,
          problemId: problem.id,
        },
      }),
      prisma.submission.count({
        where: {
          ...officialWhere,
          problemId: problem.id,
          verdict: Verdict.ACCEPTED,
        },
      }),
      latestVp
        ? prisma.submission.count({
            where: {
              contestId: cid,
              problemId: problem.id,
              virtualParticipationId: latestVp.id,
              submittedAt: {
                gte: latestVp.startedAt,
                lte: latestVp.endedAt,
              },
            },
          })
        : Promise.resolve(0),
      latestVp
        ? prisma.submission.count({
            where: {
              contestId: cid,
              problemId: problem.id,
              virtualParticipationId: latestVp.id,
              verdict: Verdict.ACCEPTED,
              submittedAt: {
                gte: latestVp.startedAt,
                lte: latestVp.endedAt,
              },
            },
          })
        : Promise.resolve(0),
    ]);

  const totalStats = officialTotalStats + vpTotalStats;
  const acStats = officialAcStats + vpAcStats;
  const info = {
    timeLimit: problem?.defaultTimeLimit || 0,
    memoryLimit: problem?.defaultMemoryLimit || 0,
    submissions: totalStats,
    accepted: acStats,
    problemType: problem.type,
  };
  // const problem = mockProblem;

  const SuperAdmin = await getCurrentSuper();
  const isAdmin =
    (SuperAdmin as unknown as UserJwtPayload)?.isGlobalAdmin ||
    (user as unknown as UserJwtPayload)?.role === ContestRole.ADMIN ||
    (user as unknown as UserJwtPayload)?.role === ContestRole.JUDGE;

  const dict = await getDictionary();

  const sections = Array.isArray(problem.sections) ? problem.sections as StatementSection[] : [];
  const samples = Array.isArray(problem.samples) ? problem.samples as ProblemSample[] : [];
  const ccData = {
    name: `${problemId} - ${problem.title}`,
    timeLimit: problem.defaultTimeLimit,
    memoryLimit: problem.defaultMemoryLimit,
    samples: getPublicProblemSamples(problem.type, samples),
  };

  const safeData =
    "CC_START" + encodeURIComponent(JSON.stringify(ccData)) + "CC_END";

  return (
    <div className="flex flex-col w-full lg:flex-row gap-6 items-start">
      <div style={{ display: "none" }}>{safeData}</div>
      {/* --- 左侧：题目基本信息卡片 --- */}
      <aside className="w-full lg:w-72 shrink-0 space-y-4">
        <ProblemAnswerSheet
          contestId={cid}
          contestStatus={contestProblem.contest.status}
          currentDisplayId={problemId}
          viewer={{
            userId: userPayload?.userId,
            globalUserId,
            runningVpId: runningVp?.id,
            latestVpId: latestVp?.id,
            externalAfterContest:
              Boolean(globalUser?.externalId) &&
              !globalUser?.isGlobalAdmin &&
              (contestProblem.contest.status === ContestStatus.ENDED ||
                new Date() >= contestProblem.contest.endTime),
          }}
        />
        <ProblemInfoCard
          contestId={contestId}
          problemId={problemId}
          info={info}
          type="problem"
          isAdmin={isAdmin}
        />
      </aside>

      {/* --- 右侧：题目详细描述 (Markdown 渲染) --- */}
      <main className="flex-1 w-full min-w-0">
        {" "}
        {/* min-w-0 防止 flex 子元素溢出 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-10">
          <header className="mb-8 border-b border-slate-200 pb-6 text-center">
            <div className="mb-3 flex justify-center">
              <span
                className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-xl font-bold text-slate-800 shadow-sm ring-1 ring-black/10 ring-inset"
                style={problemColorStyle(contestProblem.color)}
              >
                {problemId}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 wrap-break-word">
              {problem?.title}
            </h1>
            <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-medium text-slate-600 tabular-nums">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                <ClockIcon aria-hidden="true" className="size-3.5" />
                {dict.problemDetail.timeLimit} · {info.timeLimit} ms
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                <CpuChipIcon aria-hidden="true" className="size-3.5" />
                {dict.problemDetail.memoryLimit} · {info.memoryLimit} MB
              </span>
            </div>
          </header>

          {problem.type === "communication" && (
            <div className="mb-8 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <p className="font-semibold mb-1">
                {dict.problemDetail.communication}
              </p>
              <p>{dict.problemDetail.communicationNotice}</p>
            </div>
          )}

          <div className="space-y-8">
            {/* 1. 渲染常规文本段落 (Description, Input, Output) */}
            {sections.map((section, index) => (
              <div key={`section-${index}`}>
                <SectionTitle>{section.title}</SectionTitle>
                <article className="prose prose-sm md:prose-base max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-pre:bg-gray-100 prose-pre:text-gray-800 [&_mjx-container_svg]:inline-block">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeMathjax]}
                  >
                    {section.content}
                  </ReactMarkdown>
                </article>
              </div>
            ))}
            {/* 2. 渲染样例数组 */}
            {problem.type === "communication" &&
              samples.length > 0 && (
                <p className="text-sm text-gray-600">
                  {dict.problemDetail.communicationSamples}
                </p>
              )}
            {samples.map((sample, index) => {
              if (problem.type === "communication") {
                return (
                  <CommunicationSample
                    key={`sample-${index}`}
                    {...getCommunicationSampleDisplay(sample)}
                    index={samples.length > 1 ? index + 1 : undefined}
                    labels={{
                      firstRun: dict.problemDetail.firstRun,
                      secondRun: dict.problemDetail.secondRun,
                      input: dict.problemDetail.sampleInput,
                      output: dict.problemDetail.sampleOutput,
                    }}
                  />
                );
              }

              // 如果只有一组样例，标题不显示序号；如果有多组，显示 1, 2, 3...
              const suffix = samples.length > 1 ? ` ${index + 1}` : "";

              return (
                <div key={`sample-${index}`} className="grid grid-cols-1 gap-6">
                  <div>
                    <SectionTitle>
                      {dict.problemDetail.sampleInput}
                      {suffix}
                    </SectionTitle>
                    <CodeBlock code={sample.input} />
                  </div>
                  <div>
                    <SectionTitle>
                      {dict.problemDetail.sampleOutput}
                      {suffix}
                    </SectionTitle>
                    <CodeBlock code={sample.output} />
                  </div>
                </div>
              );
            })}
            {/* 3. 渲染 Hint (如果有) */}
            {problem.hint && (
              <div>
                <SectionTitle>{dict.problemDetail.hint}</SectionTitle>
                <article className="prose prose-sm md:prose-base max-w-none [&_mjx-container_svg]:inline-block">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeMathjax]}
                  >
                    {problem.hint}
                  </ReactMarkdown>
                </article>
              </div>
            )}
          </div>

          <div className="mt-12 text-center">
            {isAdmin ? (
              <button
                disabled
                className="bg-slate-400 text-white font-medium rounded-xl text-sm px-8 py-3 shadow-sm cursor-not-allowed opacity-60"
                title={dict.submit.adminCannotSubmit}
              >
                {dict.common.submit}
              </button>
            ) : (
              <Link
                href={`/contest/${contestId}/submit?problem=${problemId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-8 py-3 font-bold text-white shadow-md shadow-blue-600/20 transition hover:from-blue-700 hover:to-indigo-700 active:scale-95"
              >
                {dict.common.submit}
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
