"use server";

import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { requireContestAccess } from "@/lib/contest-access";
import { Prisma } from "@/lib/generated/prisma/client";
import { ContestRole, ClariCategory } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function getClarificationViewer(contestId: number) {
  const [session, admin] = await Promise.all([
    getCurrentUser(),
    getCurrentSuper(),
  ]);
  const payload = session as UserJwtPayload | null;
  const user = payload?.userId && payload.contestId === contestId
    ? await prisma.user.findFirst({
        where: { id: payload.userId, contestId },
        select: { id: true, role: true },
      })
    : null;

  return {
    userId: user?.id,
    isContestStaff: user?.role === ContestRole.ADMIN || user?.role === ContestRole.JUDGE,
    isAdmin: !!admin?.isGlobalAdmin || user?.role === ContestRole.ADMIN || user?.role === ContestRole.JUDGE,
  };
}

// 获取列表数据
export async function getClarificationData(
  contestId: number,
  page: number = 1
) {
  await requireContestAccess(contestId);
  const { userId, isAdmin } = await getClarificationViewer(contestId);

  // 1. 获取公告 (或者裁判公开的问答)
  const notifications = await prisma.clarification.findMany({
    where: {
      contestId,
      isPublic: true, // 关键：只看公开的
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { replies: true } },
    },
  });

  // 2. 获取针对该用户的私有提问 (管理员看所有非公开的)
  const whereCondition: Prisma.ClarificationWhereInput = {
    contestId,
    isPublic: false,
  };

  if (!isAdmin) {
    if (!userId) {
      // 未登录只能看公开的(上面已经取了)，这里私有的不给看
      whereCondition.userId = "-1";
    } else {
      whereCondition.userId = userId;
    }
  }

  const pageSize = 15;
  const skip = (page - 1) * pageSize;

  const clarifications = await prisma.clarification.findMany({
    where: whereCondition,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    include: {
      user: {
        select: { username: true, displayName: true },
      },
      _count: { select: { replies: true } },
    },
  });

  const total = await prisma.clarification.count({ where: whereCondition });

  // 获取题目列表用于提问下拉框
  const problems = await prisma.contestProblem.findMany({
    where: { contestId },
    select: { displayId: true, problemId: true },
    orderBy: { displayId: "asc" },
  });

  return { notifications, clarifications, total, problems, isAdmin, userId };
}

// 获取详情
export async function getClarificationDetail(
  contestId: number,
  clariId: number
) {
  await requireContestAccess(contestId);
  const { userId, isAdmin } = await getClarificationViewer(contestId);

  const thread = await prisma.clarification.findFirst({
    where: { id: clariId, contestId },
    include: {
      user: { select: { username: true, displayName: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { username: true, displayName: true, role: true } },
        },
      },
    },
  });

  if (!thread) return null;

  // 权限检查：如果是私有提问，且不是作者也不是管理员，禁止访问
  if (!thread.isPublic && !isAdmin && thread.userId !== userId) {
    return null;
  }

  return { thread, isAdmin, currentUserId: userId };
}

// 提交新提问 (选手)
export async function submitQuestion(formData: FormData) {
  const contestId = Number(formData.get("contestId"));
  await requireContestAccess(contestId);
  try {
    const title = formData.get("title") as string;
    const content = formData.get("content") as string;
    const displayId = formData.get("displayId") as string; // 'A', 'B' or 'General'

    const { userId } = await getClarificationViewer(contestId);
    if (!userId || !content || !title) return { error: "Missing required fields" };

    // 根据 displayId 找 problemId
    let problemId = null;
    let contestProblem = null;
    if (displayId && displayId !== "General") {
      contestProblem = await prisma.contestProblem.findFirst({
        where: {
          contestId,
          displayId: displayId,
        },
      });
      problemId = contestProblem?.problemId;
    }

    await prisma.clarification.create({
      data: {
        contestId,
        userId,
        title,
        content,
        displayId: displayId === "General" ? null : displayId,
        problemId: problemId,
        category: ClariCategory.QUESTION,
        isPublic: false,
      },
    });

    revalidatePath(`/contest/${contestId}/clarifications`);
    return { success: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to submit question" };
  }
}

// 提交回复（通用）
export async function submitReply(formData: FormData) {
    const contestId = Number(formData.get("contestId"));
    await requireContestAccess(contestId);
    const clariId = Number(formData.get("clariId"));
    const content = formData.get("content") as string;
    const { userId, isAdmin } = await getClarificationViewer(contestId);

    if (!userId || !content) return;

    const thread = await prisma.clarification.findFirst({
      where: { id: clariId, contestId },
      select: { userId: true, isPublic: true },
    });
    if (!thread || (!thread.isPublic && !isAdmin && thread.userId !== userId)) return;

    await prisma.reply.create({
      data: {
        clarificationId: clariId,
        userId,
        content,
      },
    });

    revalidatePath(`/contest/${contestId}/clarifications/${clariId}`);
    return;
}

// 管理员发布公告 Action
export async function publishAnnouncement(formData: FormData) {
    const contestId = Number(formData.get("contestId"));
    await requireContestAccess(contestId);
    const title = formData.get("title") as string;
    const content = formData.get("content") as string;
    const { userId, isContestStaff } = await getClarificationViewer(contestId);
    if (!userId || !isContestStaff) return;

    await prisma.clarification.create({
      data: {
        contestId,
        userId,
        title,
        content,
        category: ClariCategory.NOTICE,
        isPublic: true,
      },
    });
    revalidatePath(`/contest/${contestId}/clarifications`);
    return;
}

// 切换公开/私有状态
export async function toggleClarificationVisibility(
  contestId: number,
  clariId: number,
  currentStatus: boolean
) {
  await requireContestAccess(contestId);
  const { isAdmin } = await getClarificationViewer(contestId);
  if (!isAdmin) return;

  await prisma.clarification.updateMany({
    where: { id: clariId, contestId },
    data: { isPublic: !currentStatus },
  });

  // 刷新详情页和列表页
  revalidatePath(`/contest/${contestId}/clarifications`);
  revalidatePath(`/contest/${contestId}/clarifications/${clariId}`);
}
