import { NextResponse } from "next/server";
import { serialize } from "cookie";
import { cookies } from "next/headers";
import { CONTEST_ACCESS_COOKIE_PREFIX } from "@/lib/contest-access-token";

export async function POST() {
  const serializedCookie = serialize("auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.ENABLE_SECURE_COOKIE === "true",
    sameSite: "strict",
    maxAge: -1, // 立即过期
    path: "/",
  });

  const serializedCookieUser = serialize("user_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.ENABLE_SECURE_COOKIE === "true",
    sameSite: "strict",
    maxAge: -1, // 立即过期
    path: "/",
  });

  const response = NextResponse.json({ success: true });
  response.headers.append("Set-Cookie", serializedCookie);
  response.headers.append("Set-Cookie", serializedCookieUser);
  for (const cookie of (await cookies()).getAll()) {
    if (cookie.name.startsWith(CONTEST_ACCESS_COOKIE_PREFIX)) {
      response.headers.append("Set-Cookie", serialize(cookie.name, "", {
        path: "/", maxAge: 0, httpOnly: true,
      }));
    }
  }
  
  return response;
}
