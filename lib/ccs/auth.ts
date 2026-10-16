import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getJwtSecretKey, getVerifiedGlobalUser, verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { contestAccessCookieName, verifyContestAccessToken } from "@/lib/contest-access-token";

// Capture request credentials so streams can recheck access without next/headers.
export async function createCCSAuthValidator(req: NextRequest) {
  // 1. 尝试使用 Basic Auth
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Basic ")) {
    const base64Credentials = authHeader.split(" ")[1];
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf-8",
    );
    const separator = credentials.indexOf(":");
    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);

    if (separator > 0 && username && password) {
      // Check against GlobalUser (admin)
      const user = await prisma.globalUser.findUnique({
        where: { username },
      });

      if (user?.role === "SUPER_ADMIN" && user.password) {
        const isValid = await bcrypt.compare(password, user.password);
        if (isValid) return async () => true;
      }
    }
  }

  const adminToken = req.cookies.get("auth_token")?.value;
  if (adminToken && (await getVerifiedGlobalUser(adminToken))?.isGlobalAdmin) {
    return async () => true;
  }

  // 检查是否是当前比赛的管理员 (Contest Admin)
  // 获取当前请求的 contestId
  // req.nextUrl.pathname 格式通常为 /api/ccs/contests/[contestId]/...
  // 我们需要解析出 contestId
  const match = req.nextUrl.pathname.match(/\/api\/ccs\/contests\/(\d+)(?:\/|$)/);
  const userToken = req.cookies.get("user_token")?.value;
  if (!match || !userToken) return null;
  const contestId = Number(match[1]);
  const accessToken = req.cookies.get(contestAccessCookieName(contestId))?.value || "";

  return async () => {
    try {
      const payload = await verifyAuth(userToken);
      if (payload.contestId !== contestId) return false;
      const [user, contest] = await Promise.all([
        prisma.user.findUnique({ where: { id: payload.userId }, select: { contestId: true, role: true } }),
        prisma.contest.findUnique({ where: { id: contestId }, select: { id: true, type: true, password: true } }),
      ]);
      if (!contest || user?.contestId !== contestId || user.role !== ContestRole.ADMIN) return false;
      return contest.type === "PUBLIC" ||
        await verifyContestAccessToken(accessToken, contest, getJwtSecretKey());
    } catch {
      return false;
    }
  };
}

export async function checkCCSAuth(req: NextRequest) {
  const validate = await createCCSAuthValidator(req);
  return validate ? validate() : false;
}

export function unauthorizedResponse() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="CCS API"',
      "Cache-Control": "private, no-store",
    },
  });
}
