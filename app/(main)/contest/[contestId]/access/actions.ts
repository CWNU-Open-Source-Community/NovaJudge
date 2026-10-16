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

export async function unlockContest(
  contestId: number,
  _previous: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const { contest, allowed } = await getContestAccess(contestId);
  if (!contest) return { error: "比赛不存在。" };
  if (allowed) redirect(`/contest/${contestId}`);
  if (!contest.password) {
    return { error: "该私有赛尚未配置访问密码，请联系比赛管理员。" };
  }
  const password = formData.get("password");
  if (typeof password !== "string" || !matchesContestPassword(password, contest.password)) {
    return { error: "比赛密码错误，请重新输入。" };
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
