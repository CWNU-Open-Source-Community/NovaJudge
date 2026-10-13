import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVerifiedGlobalUser, verifyAuth } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { proctoringAccessAllowed, PROCTORING_HEADER, PROCTORING_REQUIRED } from "./lib/proctoring-access";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const userToken = req.cookies.get("user_token")?.value || req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  const globalToken = req.cookies.get("auth_token")?.value;
  const administrator = globalToken ? await getVerifiedGlobalUser(globalToken) : null;
  if (userToken && !administrator?.isGlobalAdmin && !["/api/auth/login", "/api/auth/logout"].includes(path)) {
    let payload;
    try { payload = await verifyAuth(userToken); } catch { /* Existing route authentication handles invalid tokens. */ }
    if (payload?.contestId && !payload.isGlobalAdmin) {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { proctoringKeyHash: true } });
      if (user && !proctoringAccessAllowed(user.proctoringKeyHash, payload, req.headers.get(PROCTORING_HEADER))) {
        const headers = { "Cache-Control": "no-store" };
        if (path.startsWith("/api/")) return NextResponse.json({ error: PROCTORING_REQUIRED, code: "PROCTORING_CLIENT_REQUIRED" }, { status: 403, headers });
        return new NextResponse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>请使用监考客户端</title><body><h1>${PROCTORING_REQUIRED}</h1></body></html>`, { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
      }
    }
  }

  // 1. 拦截 /admin 开头的所有路由
  if (path.startsWith("/admin")) {
    const token = req.cookies.get("auth_token")?.value;

    if (!token) {
      // 没登录 -> 踢回首页 (或者弹窗登录)
      return NextResponse.redirect(new URL("/", req.url));
    }

    try {
      // 验证 Token 内容
      const user = await verifyAuth(token);

      // 2. 关键：检查是否是 Global Admin
      if (!user.isGlobalAdmin) {
        // 是普通选手，想偷看后台 -> 403 Forbidden
        return NextResponse.rewrite(new URL("/403", req.url));
      }

      // 验证通过，放行
      return NextResponse.next();
    } catch (err) {
      // Token 无效
      console.log(err);
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

// 配置匹配路径
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monaco/).*)"],
};
