import type { Prisma } from "./generated/prisma/client";
import { Verdict } from "./generated/prisma/enums";
import { prisma } from "./prisma";
import type { ContestSubmissionFilters } from "./contest-rejudge-types";
import { formatMessage, zh, type Dictionary } from "./dictionaries";

function textFilter(value: unknown, label: string, copy: Dictionary["submission"], limit = 200): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > limit) {
    throw new Error(formatMessage(copy.invalidFilterValue, { filter: label }));
  }
  return value.trim();
}

function dateFilter(value: unknown, label: string, copy: Dictionary["submission"]): Date | undefined {
  const text = textFilter(value, label, copy, 40);
  if (!text) return undefined;
  // Require a timezone so the browser and server cannot interpret different times.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(formatMessage(copy.filterNeedsTimeZone, { filter: label }));
  }
  const result = new Date(text);
  if (!Number.isFinite(result.getTime())) throw new Error(formatMessage(copy.invalidFilterDate, { filter: label }));
  return result;
}

/** Shared by the manager's visible list and rejudge preview; invalid filters never widen the query. */
export async function buildContestSubmissionWhere(
  contestId: number,
  filters: ContestSubmissionFilters,
  dict: Dictionary = zh,
): Promise<Prisma.SubmissionWhereInput> {
  const copy = dict.submission;
  if (!Number.isSafeInteger(contestId) || contestId <= 0) throw new Error(copy.invalidContestId);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new Error(copy.invalidFilters);
  const where: Prisma.SubmissionWhereInput = { contestId };
  const userId = textFilter(filters.userId, dict.common.team, copy, 100);
  if (userId) where.userId = userId;

  const userSearch = textFilter(filters.userSearch, copy.teamFilterLabel, copy);
  if (userSearch) {
    const contains = { contains: userSearch, mode: "insensitive" as const };
    where.OR = [
      { user: { OR: [{ username: contains }, { displayName: contains }, { school: contains }, { seat: contains }] } },
      { globalUser: { OR: [{ username: contains }, { displayName: contains }] } },
    ];
  }

  const problem = textFilter(filters.problem, copy.problem, copy, 100);
  if (problem) {
    const contestProblem = await prisma.contestProblem.findFirst({
      where: { contestId, displayId: problem },
      select: { problemId: true },
    });
    if (!contestProblem) throw new Error(copy.foreignProblem);
    where.problemId = contestProblem.problemId;
  }

  const language = textFilter(filters.language, dict.common.language, copy, 100);
  if (language) where.language = language;
  const verdict = textFilter(filters.verdict, copy.verdict, copy, 50);
  if (verdict) {
    if (!Object.values(Verdict).includes(verdict as Verdict)) throw new Error(copy.invalidVerdict);
    where.verdict = verdict as Verdict;
  }

  const runId = textFilter(filters.runId, copy.runId, copy, 12);
  if (runId) {
    if (!/^[1-9]\d*$/.test(runId) || Number(runId) > 2147483647) throw new Error(copy.invalidRunId);
    where.displayId = Number(runId);
  }

  const from = dateFilter(filters.from, copy.submittedFrom, copy);
  const to = dateFilter(filters.to, copy.submittedTo, copy);
  if (from && to && from > to) throw new Error(copy.invalidDateRange);
  if (from || to) where.submittedAt = { ...(from && { gte: from }), ...(to && { lte: to }) };
  return where;
}
