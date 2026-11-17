"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, getCurrentUser } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { createContestSubmission } from "@/lib/contest-submission";
import { redirect } from "next/navigation";

export async function submitCode(
  contestId: number,
  problemDisplayId: string,
  language: string,
  code: string,
) {
  await requireContestAccess(contestId);
  try {
    const globalPayload = await getCurrentSuper();
    const teamPayload = globalPayload ? null : await getCurrentUser();

    if (!teamPayload && !globalPayload) {
      return { error: "Please sign in before submitting." };
    }

    if (
      teamPayload &&
      (teamPayload.role !== ContestRole.TEAM ||
        teamPayload.contestId !== contestId)
    ) {
      return { error: "Only teams in this contest can submit code." };
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
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to submit.",
    };
  }

  redirect(`/contest/${contestId}/status`);
}
