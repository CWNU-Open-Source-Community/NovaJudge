"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Verdict } from "@/lib/generated/prisma/enums";
import { enqueueJudge } from "@/lib/queue";
import { debugProblemSamples } from "@/lib/judge";
import type { ProblemSample } from "@/lib/problem-samples";

export async function adminSubmit(
  problemId: number,
  code: string,
  language: string
) {
  try {
    // 1. 身份验证 (确保是 Admin)
    const payload = await requireSuperAdmin();

    // 2. 查找 Admin 的数据库 ID
    // 注意：Token 里存的是 userId，对于 Admin 来说就是 global_users 表的 ID
    const adminId = payload.userId;

    // 3. 创建提交记录
    const submission = await prisma.submission.create({
      data: {
        displayId: -1,
        globalUserId: adminId, // 关联到 Admin
        problemId: problemId,
        language: language,
        code: code,
        codeLength: code.length,
        verdict: Verdict.PENDING, // 待评测
      },
    });

    await enqueueJudge(submission.id);

    revalidatePath(`/admin/submissions`);
    return { success: true, submissionId: submission.id };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to submit" };
  }
}

export async function debugAllSamples(
  problemId: number,
  code: string,
  language: string,
) {
  try {
    await requireSuperAdmin();

    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      select: {
        id: true,
        type: true,
        defaultTimeLimit: true,
        defaultMemoryLimit: true,
        judgeConfig: true,
        samples: true,
      },
    });

    if (!problem) {
      return { error: "Problem not found" };
    }

    const result = await debugProblemSamples(
      {
        ...problem,
        samples: problem.samples as ProblemSample[],
      },
      code,
      language,
    );

    return { success: true, data: result };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to debug samples" };
  }
}

export async function getProblemDetail(id: number) {
  await requireSuperAdmin();
  return await prisma.problem.findUnique({ where: { id } });
}
