import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import SubmissionDetailClient from "./client";
import type { ProblemSample } from "@/lib/problem-samples";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 获取提交详情，同时关联题目信息以便展示题面
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      problem: true,
      user: { select: { username: true } },
      globalUser: { select: { username: true } },
    },
  });

  if (!submission) {
    notFound();
  }

  // 格式化题目数据 (Prisma JSON -> Object)
  const formattedProblem = {
    ...submission.problem,
    hint: submission.problem.hint as string,
    sections: submission.problem.sections as unknown as {
      title: string;
      content: string;
    }[],
    samples: submission.problem.samples as unknown as ProblemSample[],
  };

  return (
    <SubmissionDetailClient
      submission={submission}
      problem={formattedProblem}
    />
  );
}
