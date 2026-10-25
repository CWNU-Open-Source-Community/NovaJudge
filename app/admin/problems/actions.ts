"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { Verdict } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requeueSubmission } from "@/lib/contest-rejudge";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isProblemType } from "@/lib/problem-judge-config";
import { normalizeProblemSamples, type ProblemSample } from "@/lib/problem-samples";

// 定义题目数据的类型接口
export interface ProblemFormData {
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: { title: string; content: string }[];
  samples: ProblemSample[];
  hint?: string;
}

// 获取题目列表
export async function getProblems(page = 1, pageSize = 20, query = "") {
  await requireSuperAdmin();
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
  await requireSuperAdmin();
  return await prisma.problem.findUnique({ where: { id } });
}

// 创建或更新题目
export async function saveProblem(formData: FormData) {
  await requireSuperAdmin();
  try {
    const id = formData.get("id") ? Number(formData.get("id")) : null;

    // 1. 解析基础数据
    const data: ProblemFormData = {
      title: formData.get("title") as string,
      type: (formData.get("type") as string) || "default",
      defaultTimeLimit: Number(formData.get("defaultTimeLimit")),
      defaultMemoryLimit: Number(formData.get("defaultMemoryLimit")),
      sections: JSON.parse(formData.get("sections") as string),
      samples: normalizeProblemSamples(JSON.parse(formData.get("samples") as string)),
      hint: formData.get("hint") as string,
    };
    if (!isProblemType(data.type)) {
      throw new Error("Problem type must be default, spj, interactive, or communication.");
    }

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
  await requireSuperAdmin();
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
  await requireSuperAdmin();
  try {
    // 1. 获取该题目下所有非 PENDING/JUDGING 的提交
    const submissions = await prisma.submission.findMany({
      where: {
        problemId: problemId,
        verdict: { notIn: [Verdict.ACCEPTED, Verdict.PENDING, Verdict.JUDGING] },
      },
      select: {
        id: true,
      },
    });

    const submissionIds = submissions.map((s) => s.id);

    if (submissionIds.length === 0) {
      return { success: true, queued: 0, skipped: 0, failed: 0 };
    }

    const result = { queued: 0, skipped: 0, failed: 0 };
    for (const id of submissionIds) {
      result[await requeueSubmission(id).catch(() => "failed" as const)]++;
    }

    // 4. 刷新页面
    revalidatePath("/admin/problems");
    return { success: result.failed === 0, ...result };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to rejudge problem" };
  }
}
