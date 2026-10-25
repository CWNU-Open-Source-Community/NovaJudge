import type { Prisma } from "./generated/prisma/client";
import { Verdict } from "./generated/prisma/enums";
import { prisma } from "./prisma";
import type { ContestSubmissionFilters } from "./contest-rejudge-types";

function textFilter(value: unknown, label: string, limit = 200): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > limit) {
    throw new Error(`${label}筛选值无效。`);
  }
  return value.trim();
}

function dateFilter(value: unknown, label: string): Date | undefined {
  const text = textFilter(value, label, 40);
  if (!text) return undefined;
  // Require a timezone so the browser and server cannot interpret different times.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(`${label}必须包含时区。`);
  }
  const result = new Date(text);
  if (!Number.isFinite(result.getTime())) throw new Error(`${label}无效。`);
  return result;
}

/** Shared by the manager's visible list and rejudge preview; invalid filters never widen the query. */
export async function buildContestSubmissionWhere(
  contestId: number,
  filters: ContestSubmissionFilters,
): Promise<Prisma.SubmissionWhereInput> {
  if (!Number.isSafeInteger(contestId) || contestId <= 0) throw new Error("比赛 ID 无效。");
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new Error("筛选条件无效。");
  const where: Prisma.SubmissionWhereInput = { contestId };
  const userId = textFilter(filters.userId, "队伍", 100);
  if (userId) where.userId = userId;

  const userSearch = textFilter(filters.userSearch, "队伍搜索");
  if (userSearch) {
    const contains = { contains: userSearch, mode: "insensitive" as const };
    where.OR = [
      { user: { OR: [{ username: contains }, { displayName: contains }, { school: contains }, { seat: contains }] } },
      { globalUser: { OR: [{ username: contains }, { displayName: contains }] } },
    ];
  }

  const problem = textFilter(filters.problem, "题目", 100);
  if (problem) {
    const contestProblem = await prisma.contestProblem.findFirst({
      where: { contestId, displayId: problem },
      select: { problemId: true },
    });
    if (!contestProblem) throw new Error("所选题目不属于本场比赛。");
    where.problemId = contestProblem.problemId;
  }

  const language = textFilter(filters.language, "语言", 100);
  if (language) where.language = language;
  const verdict = textFilter(filters.verdict, "判定结果", 50);
  if (verdict) {
    if (!Object.values(Verdict).includes(verdict as Verdict)) throw new Error("判定结果无效。");
    where.verdict = verdict as Verdict;
  }

  const runId = textFilter(filters.runId, "Run ID", 12);
  if (runId) {
    if (!/^[1-9]\d*$/.test(runId) || Number(runId) > 2147483647) throw new Error("Run ID 必须是正整数。");
    where.displayId = Number(runId);
  }

  const from = dateFilter(filters.from, "开始时间");
  const to = dateFilter(filters.to, "结束时间");
  if (from && to && from > to) throw new Error("开始时间不能晚于结束时间。");
  if (from || to) where.submittedAt = { ...(from && { gte: from }), ...(to && { lte: to }) };
  return where;
}
