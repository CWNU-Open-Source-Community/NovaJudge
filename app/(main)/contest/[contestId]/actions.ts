"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, signAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryClientIp } from "@/lib/request-ip";
import { startVirtualParticipation } from "@/lib/virtual-participation";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

function redirectToContestLogin(contestId: number, error?: string): never {
  const searchParams = new URLSearchParams();

  if (error) {
    searchParams.set("error", error);
  }

  const query = searchParams.toString();
  redirect(`/contest/${contestId}${query ? `?${query}` : ""}`);
}

// 比赛用户登录
export async function loginContestUser(contestId: number, formData: FormData) {
  await requireContestAccess(contestId);
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    redirectToContestLogin(contestId, "missing_credentials");
  }

  const user = await prisma.user.findFirst({
    where: {
      username,
      contestId: contestId,
    },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    redirectToContestLogin(contestId, "invalid_credentials");
  }

  // 记录登录 IP 和时间
  const headersList = await headers();
  const ip = getPrimaryClientIp(headersList) || "unknown";

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginIp: ip,
      lastLoginAt: new Date(),
    },
  });

  // 3. 生成 Token
  const token = await signAuth({
    userId: user.id,
    username: user.username,
    role: user.role,
    contestId: user.contestId,
    isGlobalAdmin: false,
  });

  // 4. 设置 Cookie
  const cookieStore = await cookies();
  cookieStore.set("user_token", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SECURE_COOKIE === "true",
  });

  // 5. 重定向到比赛主页
  redirect(`/contest/${contestId}?login=true`);
}

export async function startContestVirtualParticipation(contestId: number) {
  await requireContestAccess(contestId);
  const globalUser = await getCurrentSuper();
  if (!globalUser?.userId) {
    redirect(`/?login=true`);
  }

  await startVirtualParticipation(contestId, String(globalUser.userId));
  revalidatePath(`/contest/${contestId}`);
  revalidatePath(`/contest/${contestId}/rank`);
  redirect(`/contest/${contestId}/problems`);
}
