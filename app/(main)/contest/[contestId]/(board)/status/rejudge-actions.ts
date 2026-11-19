"use server";

import { revalidatePath } from "next/cache";
import { getDictionary } from "@/lib/get-dictionary";
import { executeRejudge, previewRejudge, readRejudgeProgress } from "@/lib/contest-rejudge";
import type { ContestRejudgeRequest } from "@/lib/contest-rejudge-types";

export async function previewContestRejudge(contestId: number, request: ContestRejudgeRequest) {
  return previewRejudge(contestId, request, await getDictionary());
}

export async function executeContestRejudge(contestId: number, token: string) {
  const result = await executeRejudge(contestId, token, await getDictionary());
  if (result.queued) {
    revalidatePath(`/contest/${contestId}/status`, "layout");
    revalidatePath(`/contest/${contestId}/rank`);
    revalidatePath("/admin/submissions");
  }
  return result;
}

export async function getContestRejudgeProgress(contestId: number, submissionIds: string[]) {
  return readRejudgeProgress(contestId, submissionIds, await getDictionary());
}
