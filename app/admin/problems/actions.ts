"use server";

import { Verdict } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueJudge } from "@/lib/queue";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// 定义题目数据的类型接口
export interface ProblemFormData {
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: { title: string; content: string }[];
  samples: { input: string; output: string }[];
  hint?: string;
}

// 获取题目列表
export async function getProblems(page = 1, pageSize = 20, query = "") {
  const skip = (page - 1) * pageSize;
  const where = query
    ? {
        OR: [
          { title: { contains: query } },
          // 如果 id 是数字，这里需要处理一下，暂时只搜标题
        ],
      }
    : {};

  const [problems, total] = await Promise.all([
    prisma.problem.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { id: "desc" },
    }),
    prisma.problem.count({ where }),
  ]);

  return { problems, total };
}

// 获取单道题目
export async function getProblem(id: number) {
  return await prisma.problem.findUnique({ where: { id } });
}

// 创建或更新题目
export async function saveProblem(formData: FormData) {
  try {
    const id = formData.get("id") ? Number(formData.get("id")) : null;

    // 1. 解析基础数据
    const data: ProblemFormData = {
      title: formData.get("title") as string,
      type: (formData.get("type") as string) || "default",
      defaultTimeLimit: Number(formData.get("defaultTimeLimit")),
      defaultMemoryLimit: Number(formData.get("defaultMemoryLimit")),
      sections: JSON.parse(formData.get("sections") as string),
      samples: JSON.parse(formData.get("samples") as string),
      hint: formData.get("hint") as string,
    };

    if (id) {
      // 更新
      await prisma.problem.update({
        where: { id },
        data,
      });
    } else {
      // 创建
      await prisma.problem.create({
        data,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to save problem" };
  }

  revalidatePath("/admin/problems");
  redirect("/admin/problems");
}

// 删除题目
export async function deleteProblem(id: number) {
  try {
    await prisma.problem.delete({ where: { id } });
    revalidatePath("/admin/problems");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to delete problem" };
  }
}

// 重测整题
export async function rejudgeProblem(problemId: number) {
  try {
    // 1. 获取该题目下所有非 PENDING/JUDGING 的提交
    const submissions = await prisma.submission.findMany({
      where: {
        problemId: problemId,
        verdict: { not: Verdict.ACCEPTED },
      },
      select: {
        id: true,
      },
    });

    const submissionIds = submissions.map((s) => s.id);

    if (submissionIds.length === 0) {
      return { success: true, queued: 0 };
    }

    // 2. 批量将状态重置为 PENDING
    await prisma.submission.updateMany({
      where: {
        id: { in: submissionIds },
      },
      data: {
        verdict: Verdict.PENDING,
        timeUsed: null,
        memoryUsed: null,
        errorMessage: null,
        passedTests: 0,
        totalTests: 0,
      },
    });

    // 3. 将所有 ID 推入判题队列（幂等入队，避免重复任务）
    for (const id of submissionIds) {
      await enqueueJudge(id);
    }

    // 4. 刷新页面
    revalidatePath("/admin/problems");
    return { success: true, queued: submissionIds.length };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to rejudge problem" };
  }
}
