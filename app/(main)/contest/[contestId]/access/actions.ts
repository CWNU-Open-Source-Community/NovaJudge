"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getJwtSecretKey } from "@/lib/auth";
import { getContestAccess } from "@/lib/contest-access";
import {
  CONTEST_ACCESS_MAX_AGE,
  contestAccessCookieName,
  matchesContestPassword,
  signContestAccessToken,
} from "@/lib/contest-access-token";

type ContestAccessState = { error: "notFound" | "unconfigured" | "wrongPassword" | null };

export async function unlockContest(
  contestId: number,
  _previous: ContestAccessState,
  formData: FormData,
): Promise<ContestAccessState> {
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) return { error: "notFound" };
  if (allowed) redirect(`/contest/${contestId}`);
  if (!contest.password) {
    return { error: "unconfigured" };
  }
  const password = formData.get("password");
  if (typeof password !== "string" || !matchesContestPassword(password, contest.password)) {
    return { error: "wrongPassword" };
  }
  const token = await signContestAccessToken(contest, getJwtSecretKey());
  (await cookies()).set(contestAccessCookieName(contestId), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CONTEST_ACCESS_MAX_AGE,
    secure: process.env.NODE_ENV === "production" && process.env.ENABLE_SECURE_COOKIE === "true",
  });
  redirect(`/contest/${contestId}`);
}
