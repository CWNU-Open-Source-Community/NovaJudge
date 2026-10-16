import { signAuth, verifyAuth } from "@/lib/auth";
import { ContestRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getClientIpCandidates } from "@/lib/request-ip";
import { NextRequest, NextResponse } from "next/server";
import { contestAccessResponse } from "@/lib/contest-access";

interface Props {
  params: Promise<{ contestId: string }>;
}

function contestRedirect(contestId: number, query = "") {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: `/contest/${contestId}${query}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(req: NextRequest, { params }: Props) {
  const { contestId } = await params;
  const cid = Number(contestId);
  if (!Number.isInteger(cid)) {
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/",
      },
    });
  }

  const denied = await contestAccessResponse(cid);
  if (denied) {
    if (denied.status === 403) return contestRedirect(cid, "/access");
    return denied;
  }

  const existingUserToken = req.cookies.get("user_token")?.value;
  if (existingUserToken) {
    try {
      const payload = await verifyAuth(existingUserToken);
      if (payload.contestId === cid) {
        return contestRedirect(cid, "?login=true");
      }
    } catch {}
  }

  const authToken = req.cookies.get("auth_token")?.value;
  if (authToken) {
    try {
      const payload = await verifyAuth(authToken);
      if (payload.isGlobalAdmin) {
        return contestRedirect(cid, "");
      }
    } catch {}
  }

  const clientIps = getClientIpCandidates(req.headers);
  if (clientIps.length === 0) {
    return contestRedirect(cid, "?autoLogin=miss&reason=no_ip");
  }

  const user = await prisma.user.findFirst({
    where: {
      contestId: cid,
      role: ContestRole.TEAM,
      autoLoginIp: { in: clientIps },
    },
    select: {
      id: true,
      username: true,
      role: true,
      contestId: true,
      autoLoginIp: true,
      proctoringKeyHash: true,
    },
  });

  if (!user) {
    return contestRedirect(cid, "?autoLogin=miss&reason=no_match");
  }
  if (user.proctoringKeyHash) return contestRedirect(cid, "?autoLogin=miss&error=proctoring_required");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginIp: user.autoLoginIp,
      lastLoginAt: new Date(),
    },
  });

  const token = await signAuth({
    userId: user.id,
    username: user.username,
    role: user.role,
    contestId: user.contestId,
    isGlobalAdmin: false,
  });

  const response = contestRedirect(cid, "?login=true");
  response.cookies.set("user_token", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_SECURE_COOKIE === "true",
  });

  return response;
}
