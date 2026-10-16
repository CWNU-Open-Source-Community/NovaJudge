"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { createContestSubmission } from "@/lib/contest-submission";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function submitCode(
  contestId: number,
  problemDisplayId: string,
  language: string,
  code: string,
) {
  await requireContestAccess(contestId);
  try {
    const cookieStore = await cookies();
    const teamToken = cookieStore.get("user_token")?.value;
    const globalPayload = await getCurrentSuper();

    if (!teamToken && !globalPayload) {
      return { error: "Please sign in before submitting." };
    }

    const teamPayload = teamToken ? await verifyAuth(teamToken) : null;
    if (!teamPayload && !globalPayload) {
      return { error: "Invalid token." };
    }

    const userId = teamPayload?.userId || null;
    if (userId && teamPayload?.role !== ContestRole.TEAM) {
      return { error: "Only contest teams can submit code." };
    }

    const globalUserId =
      !userId && globalPayload?.userId ? String(globalPayload.userId) : null;

    if (!userId && !globalUserId) {
      return { error: "Invalid submitter." };
    }

    await createContestSubmission({
      contestId,
      problemDisplayId,
      language,
      code,
      actor: userId
        ? {
            type: "contest",
            userId,
            role: teamPayload?.role || "",
            isGlobalAdmin: teamPayload?.isGlobalAdmin,
          }
        : {
            type: "global",
            globalUserId: globalUserId!,
            isGlobalAdmin: globalPayload?.isGlobalAdmin,
          },
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to submit.",
    };
  }

  redirect(`/contest/${contestId}/status`);
}
