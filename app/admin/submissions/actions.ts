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

// ============ 条件批量重测 ============

// 批量重测的筛选条件
export interface RejudgeFilters {
  contestId?: number | null; // 按比赛
  problemId?: number | null; // 按题目
  verdict?: string | null; // 按判定结果
  username?: string | null; // 按队伍/用户（模糊匹配）
  from?: string | null; // 提交时间起点 (datetime-local)
  to?: string | null; // 提交时间终点 (datetime-local)
  includeAccepted?: boolean; // 是否包含已 AC 的提交
}

// 单次批量重测的上限，防止误操作把整库灌入队列
const MAX_REJUDGE_BATCH = 5000;

// 根据筛选条件构造 Prisma where（供 count 与 findMany 共用）
function buildRejudgeWhere(filters: RejudgeFilters) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (filters.contestId) where.contestId = Number(filters.contestId);
  if (filters.problemId) where.problemId = Number(filters.problemId);

  // 判定结果：显式指定时直接使用；否则排除进行中的提交（必要时也排除 AC）
  if (filters.verdict) {
    where.verdict = filters.verdict;
  } else {
    const excluded: string[] = [Verdict.PENDING, Verdict.JUDGING];
    if (!filters.includeAccepted) excluded.push(Verdict.ACCEPTED);
    where.verdict = { notIn: excluded };
  }

  // 队伍/用户模糊搜索（比赛用户 + 全局用户）
  const username = filters.username?.trim();
  if (username) {
    where.OR = [
      { user: { username: { contains: username, mode: "insensitive" } } },
      {
        globalUser: {
          username: { contains: username, mode: "insensitive" },
        },
      },
    ];
  }

  // 时间范围
  const time: { gte?: Date; lte?: Date } = {};
  if (filters.from) time.gte = new Date(filters.from);
  if (filters.to) time.lte = new Date(filters.to);
  if (time.gte || time.lte) where.submittedAt = time;

  return where;
}

// 校验管理员权限
async function requireGlobalAdmin() {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) throw new Error("Unauthorized");

  const payload = await verifyAuth(token);
  if (!payload.isGlobalAdmin) throw new Error("Permission denied");
}

// 预览符合条件的提交数量（重测前确认用）
export async function countRejudgeCandidates(
  filters: RejudgeFilters,
): Promise<{ count?: number; error?: string }> {
  try {
    await requireGlobalAdmin();
    const count = await prisma.submission.count({
      where: buildRejudgeWhere(filters),
    });
    return { count };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: (e as any).message || "Failed to count submissions" };
  }
}

// 按条件批量重测：重置状态并重新入队
export async function rejudgeByFilters(
  filters: RejudgeFilters,
): Promise<{ success?: boolean; queued?: number; error?: string }> {
  try {
    await requireGlobalAdmin();

    const where = buildRejudgeWhere(filters);

    const count = await prisma.submission.count({ where });
    if (count === 0) {
      return { error: "No matching submissions found." };
    }
    if (count > MAX_REJUDGE_BATCH) {
      return {
        error: `Matched ${count} submissions, which exceeds the safety limit of ${MAX_REJUDGE_BATCH}. Please narrow the filters.`,
      };
    }

    const submissions = await prisma.submission.findMany({
      where,
      select: { id: true },
    });
    const submissionIds = submissions.map((s) => s.id);

    // 1. 批量重置为 PENDING 并清空旧结果
    await prisma.submission.updateMany({
      where: { id: { in: submissionIds } },
      data: {
        verdict: Verdict.PENDING,
        timeUsed: null,
        memoryUsed: null,
        errorMessage: null,
        passedTests: 0,
        totalTests: 0,
      },
    });

    // 2. 幂等入队（enqueueJudge 内部保证不会重复入队）
    for (const id of submissionIds) {
      await enqueueJudge(id);
    }

    revalidatePath("/admin/submissions");
    return { success: true, queued: submissionIds.length };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: (e as any).message || "Failed to rejudge submissions" };
  }
}
