"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { verifyAuth } from "@/lib/auth";
import { cookies } from "next/headers";
import { Verdict } from "@/lib/generated/prisma/enums";
import { enqueueJudge } from "@/lib/queue";

export async function getGlobalSubmissions(
  page = 1,
  pageSize = 20,
  problemQuery = "",
) {
  const skip = (page - 1) * pageSize;
  const query = problemQuery.trim();
  const problemId = Number(query);
  const where = query
    ? {
        problem: {
          OR: [
            ...(Number.isInteger(problemId) && problemId > 0
              ? [{ id: problemId }]
              : []),
            {
              title: {
                contains: query,
                mode: "insensitive" as const,
              },
            },
          ],
        },
      }
    : {};

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { submittedAt: "desc" },
      include: {
        user: { select: { username: true } }, // 选手信息
        globalUser: { select: { username: true } }, // 管理员信息
        problem: { select: { title: true } }, // 题目信息
        contest: { select: { title: true, id: true } }, // 比赛信息
      },
    }),
    prisma.submission.count({ where }),
  ]);

  return { submissions, total };
}

export async function rejudgeSubmission(submissionId: string) {
  // 1. 权限验证
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) throw new Error("Unauthorized");

  const payload = await verifyAuth(token);
  if (!payload.isGlobalAdmin) throw new Error("Permission denied");

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { verdict: true },
  });

  if (!submission) {
    return { error: "Submission not found" };
  }

  if (submission.verdict === Verdict.ACCEPTED) {
    return { error: "Accepted submissions are not rejudged." };
  }

  // 2. 重置提交状态
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      verdict: Verdict.PENDING,
      timeUsed: null,
      memoryUsed: null,
      errorMessage: null,
      passedTests: 0,
      totalTests: 0,
    },
  });

  // judgeSubmission(submissionId).catch(console.error);

  await enqueueJudge(submissionId);

  // 4. 刷新页面
  revalidatePath("/admin/submissions");
  return { success: true };
}
