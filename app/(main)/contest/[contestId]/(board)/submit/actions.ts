"use server";

import { requireContestAccess } from "@/lib/contest-access";
import { usesDomjudge } from "@/lib/contest-interface";

import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { ContestSubmissionError, createContestSubmission } from "@/lib/contest-submission";
import type { Dictionary } from "@/lib/dictionaries";
import { contestLanguages } from "@/lib/contest-languages";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function saveSolution(
  contestId: number,
  problemDisplayId: string,
  language: string,
  code: string,
  source: "editor" | "team-file",
): Promise<{ error: keyof Dictionary["submissionErrors"] } | undefined> {
  await requireContestAccess(contestId);
  try {
    const globalPayload = await getCurrentSuper();
    const teamPayload = globalPayload ? null : await getCurrentUser();

    if (!teamPayload && !globalPayload) {
      return { error: "signInRequired" };
    }
    if (source === "team-file") {
      if (!teamPayload) return { error: "teamRequired" };
      if (!contestLanguages.some(item => item.value === language) || typeof code !== "string" || !code.trim()) {
        return { error: "invalidSource" };
      }
    }

    if (
      teamPayload &&
      (teamPayload.role !== ContestRole.TEAM ||
        teamPayload.contestId !== contestId)
    ) {
      return { error: "teamRequired" };
    }

    await createContestSubmission({
      contestId,
      problemDisplayId,
      language,
      code,
      actor: globalPayload
        ? {
            type: "global",
            globalUserId: String(globalPayload.userId),
            isGlobalAdmin: globalPayload.isGlobalAdmin,
          }
        : {
            type: "contest",
            userId: teamPayload!.userId,
            role: teamPayload!.role,
            isGlobalAdmin: teamPayload!.isGlobalAdmin,
          },
    });
  } catch (error) {
    if (error instanceof ContestSubmissionError) return { error: error.code };
    console.error("Could not submit contest code", error);
    return { error: "failed" };
  }
}

export async function submitCode(contestId: number, problem: string, language: string, code: string) {
  const failure = await saveSolution(contestId, problem, language, code, "editor");
  if (failure) return failure;
  const home = `/contest/${contestId}`;
  if (await usesDomjudge(contestId)) {
    revalidatePath(home);
    redirect(home);
  }
  redirect(`${home}/status`);
}

export async function submitTeamFile(contestId: number, problem: string, language: string, code: string) {
  return saveSolution(contestId, problem, language, code, "team-file");
}
