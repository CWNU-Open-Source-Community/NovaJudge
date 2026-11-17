import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signAuth } from "@/lib/auth";
import { externalLoginEnabled } from "@/lib/external-login";

export async function POST(req: Request) {
  const url = process.env.EXTERNAL_AUTH_URL || "";
  const body = await req.json();
  const username = String(body?.username || "");
  const password = String(body?.password || "");
  const appKey = process.env.APP_KEY || "";

  const systemSetting = await prisma.systemSetting.findUnique({
    where: { id: "default" },
    select: { allowExternalLogin: true },
  });

  if (!externalLoginEnabled(systemSetting, url)) {
    return NextResponse.json(
      { error: "External login is disabled" },
      { status: 403 },
    );
  }

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password required" },
      { status: 400 },
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account: username,
      credential: password,
      loginType: "password",
      appKey,
    }),
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: "External auth failed" },
      { status: 401 },
    );
  }
  const json = await res.json();
  const data = json?.data;
  if (json?.code !== 200 || !data?.userId || !data?.userAccount) {
    return NextResponse.json(
      { error: "Invalid external response" },
      { status: 401 },
    );
  }

  const externalId = String(data.userId);
  const extUsername = String(data.userAccount);
  const displayName = data.realName ? String(data.realName) : null;
  const studentId = data.numberId ? String(data.numberId) : null;
  const email = data.email ? String(data.email) : null;

  const user = await prisma.globalUser.upsert({
    where: { externalId },
    update: {
      username: extUsername,
      displayName,
      studentId,
      email,
      role: "GLOBAL_USER",
    },
    create: {
      externalId,
      username: extUsername,
      displayName,
      studentId,
      email,
      role: "GLOBAL_USER",
    },
  });

  if (user.isBanned) {
    return NextResponse.json(
      { error: "Account has been banned" },
      { status: 403 },
    );
  }

  const token = await signAuth({
    userId: user.id,
    username: user.username,
    role: user.role,
    contestId: null,
    isGlobalAdmin: false,
  });

  const response = NextResponse.json({
    success: true,
    user: {
      userId: user.id,
      username: user.username,
      role: user.role,
      isGlobalAdmin: false,
      contestId: null,
      displayName: user.displayName,
      studentId: user.studentId,
      email: user.email,
    },
  });
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SECURE_COOKIE === "true",
    sameSite: "strict",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  response.cookies.set("user_token", "", {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SECURE_COOKIE === "true",
    sameSite: "lax",
    maxAge: 0,
    expires: new Date(0),
    path: "/",
  });
  return response;
}
