import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryClientIp } from "@/lib/request-ip";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { serialize } from "cookie";
import { contestAccessResponse } from "@/lib/contest-access";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password, contestId, isGlobalAdmin } = body;

    let user = null;
    let role = "";
    let effectiveContestId = null;

    if (isGlobalAdmin) {
      // 1. 超级管理员登录逻辑
      user = await prisma.globalUser.findUnique({ where: { username } });
      if (!user || user.role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "User not found" }, { status: 401 });
      }
      role = user.role;
    } else {
      // 2. 比赛用户登录逻辑
      if (!contestId) {
        return NextResponse.json(
          { error: "Contest ID is required" },
          { status: 400 }
        );
      }
      const denied = await contestAccessResponse(Number(contestId));
      if (denied) return denied;
      // 使用联合索引查询
      user = await prisma.user.findUnique({
        where: {
          contestId_username: {
            contestId: Number(contestId),
            username: username,
          },
        },
      });
      if (user) {
        role = user.role;
        effectiveContestId = user.contestId;

        // 记录登录 IP 和时间
        const ip = getPrimaryClientIp(req.headers) || "unknown";
        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginIp: ip,
            lastLoginAt: new Date(),
          },
        });
      }
    }

    // 3. 验证用户是否存在
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    if (!user.password) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // 4. 验证密码 (假设数据库存的是 hash，如果是明文测试请直接比较)
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // 5. 生成 JWT Token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: role,
        contestId: effectiveContestId, // 如果是超管，这里是 null
        isGlobalAdmin: !!isGlobalAdmin,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" } // 1天过期
    );

    // 6. 设置 HTTP-Only Cookie
    const serializedCookie = serialize("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" && process.env.ENABLE_SECURE_COOKIE === "true",
      sameSite: "strict",
      maxAge: 60 * 60 * 24, // 1 day
      path: "/",
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          userId: user.id,
          username: user.username,
          role: role,
          contestId: effectiveContestId,
          isGlobalAdmin: !!isGlobalAdmin, // 关键：必须返回这个字段
        },
      },
      { headers: { "Set-Cookie": serializedCookie } }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
