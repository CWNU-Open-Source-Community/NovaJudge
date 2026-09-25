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
import { redirect } from "next/navigation";
import { Metadata } from "next";
import {
  getLatestVirtualParticipation,
  getRunningVirtualParticipation,
} from "@/lib/virtual-participation";

type Problem = {
  id: number;
  title: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;

  sections: {
    title: string;
    content: string;
  }[];

  samples: ProblemSample[];

  hint: string;
};

interface Props {
  params: Promise<{
    contestId: string;
    problemId: string;
  }>;
}
// 提取公共样式：标题样式 (蓝色竖线)
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-lg font-bold text-blue-800 border-l-4 border-blue-600 pl-3 mb-3 font-serif tracking-wide">
    {children}
  </h3>
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contestId = parseInt((await params).contestId);
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
      title: "题目未找到",
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

  // 如果是私有比赛，且未登录比赛账号且不是超管，则重定向
  if (
    contestProblem.contest.type === "PRIVATE" &&
    !(globalUser as unknown as UserJwtPayload)?.isGlobalAdmin &&
    !(
      globalUser &&
      (contestProblem.contest.status === ContestStatus.ENDED ||
        new Date() >= contestProblem.contest.endTime)
    ) &&
    (!userPayload || userPayload.contestId !== cid)
  ) {
    redirect(`/contest/${contestId}`);
  }

  const problem = contestProblem.problem;

  if (!problem || contestProblem.contest.status === ContestStatus.PENDING)
    notFound();

  // 2. 封榜统计逻辑
  const config = contestProblem.contest.config as {
    frozenDuration?: number;
  } | null;
  const frozenDuration = config?.frozenDuration ?? 0;
  const endTime = contestProblem.contest.endTime;

  let dateFilter = {};

  if (frozenDuration > 0 && endTime) {
    const freezeTime = new Date(endTime.getTime() - frozenDuration * 60 * 1000);
    dateFilter = {
      submittedAt: {
        lt: freezeTime,
      },
    };
  }

  if (runningVp) {
    const now = new Date();
    dateFilter = {
      submittedAt: {
        lte: new Date(
          Math.min(
            contestProblem.contest.startTime.getTime() +
              (now.getTime() - runningVp.startedAt.getTime()),
            contestProblem.contest.endTime.getTime(),
          ),
        ),
      },
    };
  }

  const [officialTotalStats, officialAcStats, vpTotalStats, vpAcStats] =
    await Promise.all([
      prisma.submission.count({
        where: {
          contestId: cid,
          problemId: problem.id,
          virtualParticipationId: null,
          ...dateFilter,
        },
      }),
      prisma.submission.count({
        where: {
          contestId: cid,
          problemId: problem.id,
          verdict: Verdict.ACCEPTED,
          virtualParticipationId: null,
          ...dateFilter,
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

  const ccData = {
    name: `${problemId} - ${problem.title}`,
    timeLimit: problem.defaultTimeLimit,
    memoryLimit: problem.defaultMemoryLimit,
    samples: getPublicProblemSamples(
      problem.type,
      (problem as unknown as Problem).samples,
    ),
  };

  const safeData =
    "CC_START" + encodeURIComponent(JSON.stringify(ccData)) + "CC_END";

  return (
    <div className="flex flex-col w-full lg:flex-row gap-6 items-start">
      <div style={{ display: "none" }}>{safeData}</div>
      {/* --- 左侧：题目基本信息卡片 --- */}
      <aside className="w-full lg:w-72 shrink-0 space-y-4">
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
        <div className="bg-white border border-gray-200 shadow-sm rounded-sm p-6 lg:p-10">
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-8 text-center border-b pb-4">
            {problem?.title}
          </h1>

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
            {(problem as unknown as Problem).sections?.map((section, index) => (
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
              (problem as unknown as Problem).samples.length > 0 && (
                <p className="text-sm text-gray-600">
                  {dict.problemDetail.communicationSamples}
                </p>
              )}
            {(problem as unknown as Problem).samples.map((sample, index) => {
              if (problem.type === "communication") {
                return (
                  <CommunicationSample
                    key={`sample-${index}`}
                    {...getCommunicationSampleDisplay(sample)}
                    index={
                      (problem as unknown as Problem).samples.length > 1
                        ? index + 1
                        : undefined
                    }
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
              const suffix =
                (problem as unknown as Problem).samples.length > 1
                  ? ` ${index + 1}`
                  : "";

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
            {/* 3. 渲染 Hint (如果有) */}
            {problem.hint && (
              <div>
                <SectionTitle>Hint</SectionTitle>
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
                className="bg-gray-400 text-white font-medium rounded-sm text-sm px-8 py-3 shadow-md cursor-not-allowed opacity-60"
                title="Cannot submit"
              >
                {dict.common.submit}
              </button>
            ) : (
              <Link
                href={`/contest/${contestId}/submit?problem=${problemId}`}
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-sm font-bold shadow-md transition-transform active:scale-95"
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
