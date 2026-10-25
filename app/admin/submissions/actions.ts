"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Verdict } from "@/lib/generated/prisma/enums";
import { requeueSubmission } from "@/lib/contest-rejudge";

export async function getGlobalSubmissions(
  page = 1,
  pageSize = 20,
  problemQuery = "",
  teamQuery = "",
) {
  await requireSuperAdmin();
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
  const teamSearch = teamQuery.trim();
  const submissionWhere = {
    ...where,
    ...(teamSearch ? {
      OR: [
        { user: { OR: ["username", "displayName", "school", "seat"].map((field) => ({
          [field]: { contains: teamSearch, mode: "insensitive" as const },
        })) } },
        { globalUser: { OR: ["username", "displayName"].map((field) => ({
          [field]: { contains: teamSearch, mode: "insensitive" as const },
        })) } },
      ],
    } : {}),
  };

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where: submissionWhere,
      skip,
      take: pageSize,
      orderBy: { submittedAt: "desc" },
      include: {
        user: { select: { id: true, username: true, displayName: true, school: true, seat: true } },
        globalUser: { select: { username: true, displayName: true } },
        problem: { select: { title: true } }, // 题目信息
        contest: { select: { title: true, id: true } }, // 比赛信息
      },
    }),
    prisma.submission.count({ where: submissionWhere }),
  ]);

  return { submissions, total };
}

export async function rejudgeSubmission(submissionId: string, includeAccepted = false) {
  // 1. 权限验证
  await requireSuperAdmin();

  const result = await requeueSubmission(submissionId, { includeAccepted: includeAccepted === true });
  if (result === "skipped") return { error: "该提交已在评测中、不存在或未允许重判 AC，请刷新后重试。" };
  if (result === "failed") return { error: "重判入队失败，请稍后重试。" };
  revalidatePath("/admin/submissions");
  return { success: true };
}

// ============ 条件批量重测 ============

// 批量重测的筛选条件
export interface RejudgeFilters {
  contestId?: number | null; // 按比赛
  problemId?: number | null; // 按题目
  verdict?: string | null; // 按判定结果
  username?: string | null; // 队名、账号、学校、座位号（模糊匹配）
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

  for (const key of ["contestId", "problemId"] as const) {
    const value = filters[key];
    if (value !== undefined && value !== null) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid ${key}.`);
      }
      where[key] = value;
    }
  }

  // 显式指定判定结果也必须遵循 AC 开关，且始终跳过正在评测的提交。
  const excluded: Verdict[] = [Verdict.PENDING, Verdict.JUDGING];
  if (filters.includeAccepted !== true) excluded.push(Verdict.ACCEPTED);
  if (filters.verdict) {
    if (!Object.values(Verdict).includes(filters.verdict as Verdict)) {
      throw new Error("Invalid verdict filter.");
    }
    where.verdict = { equals: filters.verdict, notIn: excluded };
  } else {
    where.verdict = { notIn: excluded };
  }

  // 队伍/用户模糊搜索（比赛用户 + 全局用户）
  const username = filters.username?.trim();
  if (username) {
    where.OR = [
      { user: { OR: ["username", "displayName", "school", "seat"].map((field) => ({
        [field]: { contains: username, mode: "insensitive" },
      })) } },
      {
        globalUser: {
          OR: ["username", "displayName"].map((field) => ({
            [field]: { contains: username, mode: "insensitive" },
          })),
        },
      },
    ];
  }

  // 时间范围
  const time: { gte?: Date; lte?: Date } = {};
  if (filters.from) time.gte = new Date(filters.from);
  if (filters.to) time.lte = new Date(filters.to);
  if ((time.gte && !Number.isFinite(time.gte.getTime())) ||
      (time.lte && !Number.isFinite(time.lte.getTime())) ||
      (time.gte && time.lte && time.gte > time.lte)) {
    throw new Error("Invalid submission time range.");
  }
  if (time.gte || time.lte) where.submittedAt = time;

  return where;
}

// 预览符合条件的提交数量（重测前确认用）
export async function countRejudgeCandidates(
  filters: RejudgeFilters,
): Promise<{ count?: number; error?: string }> {
  try {
    await requireSuperAdmin();
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
): Promise<{ success?: boolean; queued?: number; skipped?: number; failed?: number; error?: string }> {
  try {
    await requireSuperAdmin();

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
      take: MAX_REJUDGE_BATCH + 1,
    });
    const submissionIds = submissions.map((s) => s.id);
    if (submissionIds.length > MAX_REJUDGE_BATCH) {
      return { error: "匹配数量已超过上限，请缩小筛选范围。" };
    }
    const result = { queued: 0, skipped: 0, failed: 0 };
    for (const id of submissionIds) {
      const outcome = await requeueSubmission(id, {
        contestId: filters.contestId ?? undefined,
        includeAccepted: filters.includeAccepted === true,
      }).catch(() => "failed" as const);
      result[outcome]++;
    }

    revalidatePath("/admin/submissions");
    return { success: result.failed === 0, ...result };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: (e as any).message || "Failed to rejudge submissions" };
  }
}
