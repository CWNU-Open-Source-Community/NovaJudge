import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getVerifiedContestUser,
  getVerifiedGlobalUser,
} from "@/lib/auth";

function expireCookie(
  response: NextResponse,
  name: "auth_token" | "user_token",
  sameSite: "strict" | "lax",
) {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SECURE_COOKIE === "true",
    sameSite,
    maxAge: 0,
    expires: new Date(0),
    path: "/",
  });
}

export async function GET() {
  try {
    const store = await cookies();
    const authToken = store.get("auth_token")?.value;
    const userToken = store.get("user_token")?.value;

    if (authToken) {
      const user = await getVerifiedGlobalUser(authToken);
      if (user) {
        const response = NextResponse.json({
          user: {
            username: user.username,
            role: user.role,
            isGlobalAdmin: !!user.isGlobalAdmin,
            contestId: user.contestId ?? null,
            displayName: user.displayName,
            studentId: user.studentId,
            email: user.email,
          },
        });
        if (userToken) expireCookie(response, "user_token", "lax");
        return response;
      }
    }

    if (userToken) {
      const user = await getVerifiedContestUser(userToken);
      if (user) {
        const response = NextResponse.json({
          user: {
            username: user.username,
            role: user.role,
            isGlobalAdmin: false,
            contestId: user.contestId ?? null,
          },
        });
        if (authToken) expireCookie(response, "auth_token", "strict");
        return response;
      }
    }

    const response = NextResponse.json({ user: null });
    if (authToken) expireCookie(response, "auth_token", "strict");
    if (userToken) expireCookie(response, "user_token", "lax");
    return response;
  } catch {
    return NextResponse.json({ user: null });
  }
}
