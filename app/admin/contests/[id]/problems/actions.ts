"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// 获取当前比赛的题目列表
export async function getContestProblems(contestId: number) {
  await requireSuperAdmin();
  const problems = await prisma.contestProblem.findMany({
    where: { contestId },
    include: {
      problem: true, // 关联获取题目原本的信息
    },
    orderBy: {
      displayId: "asc", // 按 A, B, C 排序
    },
  });
  return problems;
}

// 将题库中的题目加入比赛
export async function addContestProblem(formData: FormData) {
  await requireSuperAdmin();
  const contestId = Number(formData.get("contestId"));
  const problemId = Number(formData.get("problemId")); // 题库中的原始 ID
  const displayId = formData.get("displayId") as string; // A, B, C...
  const color = formData.get("color") as string; // 气球颜色

  if (!problemId || !displayId) throw new Error("Missing required fields");

  // 1. 检查题目是否存在
  const problem = await prisma.problem.findUnique({ where: { id: problemId } });
  if (!problem) throw new Error(`Problem #${problemId} not found in the bank.`);

  // 2. 检查 DisplayId 是否冲突 (比如已经有题目叫 A 了)
  const existing = await prisma.contestProblem.findUnique({
    where: {
      contestId_displayId: { contestId, displayId },
    },
  });

  if (existing)
    throw new Error(`Display ID ${displayId} is already used in this contest.`);

  // 3. 创建关联
  await prisma.contestProblem.create({
    data: {
      contestId,
      problemId,
      displayId,
      color: color || null,
    },
  });

  revalidatePath(`/admin/contests/${contestId}/problems`);
}

// 从比赛中移除题目 (解除关联，不删除原题)
export async function removeContestProblem(id: string, contestId: number) {
  await requireSuperAdmin();
  await prisma.contestProblem.delete({
    where: { id },
  });
  revalidatePath(`/admin/contests/${contestId}/problems`);
}

export async function updateProblemDisplayId(
  contestProblemId: number,
  newDisplayId: string,
  contestId: number,
) {
  await requireSuperAdmin();
  try {
    if (!newDisplayId.trim()) {
      return { error: "Display ID 不能为空" };
    }

    // 检查是否已有重复的 Display ID
    const existing = await prisma.contestProblem.findFirst({
      where: {
        contestId: contestId,
        displayId: newDisplayId,
        problemId: { not: contestProblemId },
      },
    });

    if (existing) {
      return { error: `题号 ${newDisplayId} 已被其他题目使用` };
    }

    // 更新 displayId
    await prisma.contestProblem.update({
      where: {
        contestId_problemId: {
          contestId: contestId,
          problemId: contestProblemId,
        },
      },
      data: { displayId: newDisplayId.toUpperCase() }, // 建议转为大写
    });

    // 刷新相关页面的缓存
    revalidatePath(`/admin/contests/${contestId}/problems`);
    revalidatePath(`/contest/${contestId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to update displayId:", error);
    return { error: "更新失败，请重试" };
  }
}

export async function updateProblemColor(
  contestProblemId: string,
  newColor: string,
  contestId: number,
) {
  await requireSuperAdmin();
  try {
    const color = newColor.trim();

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return { error: "Invalid color value" };
    }

    await prisma.contestProblem.update({
      where: { id: contestProblemId },
      data: { color: color.toLowerCase() },
    });

    revalidatePath(`/admin/contests/${contestId}/problems`);
    revalidatePath(`/contest/${contestId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to update problem color:", error);
    return { error: "Failed to update color, please try again" };
  }
}

export async function swapProblemDisplayIds(
  contestId: number,
  problemId1: number,
  problemId2: number
) {
  await requireSuperAdmin();
  try {
    // 1. 查出需要交换的两道题目
    const problem1 = await prisma.contestProblem.findFirst({
      where: { contestId: contestId, problemId: problemId1 },
    });
    const problem2 = await prisma.contestProblem.findFirst({
      where: { contestId: contestId, problemId: problemId2 },
    });

    if (!problem1 || !problem2) {
      return { error: "未找到对应的比赛题目" };
    }

    await prisma.$transaction([
      prisma.contestProblem.update({
        where: { id: problem1.id },
        data: { displayId: `TEMP_SWAP_${problem1.id}` },
      }),
      prisma.contestProblem.update({
        where: { id: problem2.id },
        data: { displayId: problem1.displayId },
      }),
      prisma.contestProblem.update({
        where: { id: problem1.id },
        data: { displayId: problem2.displayId },
      }),
    ]);

    // 3. 刷新前端路由缓存
    revalidatePath(`/admin/contests/${contestId}/problems`);
    revalidatePath(`/contest/${contestId}`);

    return { success: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("Failed to swap displayIds:", error);
    return { error: "交换题目顺序失败" };
  }
}
