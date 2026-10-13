import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

// 定义 Token 中包含的数据类型，与你在登录接口生成的保持一致
export interface UserJwtPayload {
  userId: string;
  username: string;
  role: string;
  contestId?: number | null;
  isGlobalAdmin: boolean;
  loginSource?: "PROCTORING";
  proctoringKeyHash?: string;
  iat?: number;
  exp?: number;
}

export interface GlobalUserJwtPayload extends UserJwtPayload {
  displayName?: string | null;
  studentId?: string | null;
  email?: string | null;
}

// 获取密钥并转换为 Uint8Array（jose 要求的格式）
export const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error("The environment variable JWT_SECRET is not set.");
  }
  return new TextEncoder().encode(secret);
};

export async function signAuth(payload: Omit<UserJwtPayload, "iat" | "exp">) {
  const secret = getJwtSecretKey();
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h") // Token 有效期
    .sign(secret);
  return token;
}

export async function verifyAuth(token: string): Promise<UserJwtPayload> {
  try {
    const verified = await jwtVerify(token, getJwtSecretKey());
    return verified.payload as unknown as UserJwtPayload;
  } catch (error) {
    console.log(error);
    throw new Error("Your token has expired or is invalid.");
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("user_token")?.value;

  if (!token) return null;

  try {
    const payload = await verifyAuth(token);
    return payload;
  } catch (error) {
    console.log(error);
    return new Error("Your token has expired or is invalid.");
  }
}

export async function getVerifiedGlobalUser(
  token: string
): Promise<GlobalUserJwtPayload | null> {
  try {
    const payload = await verifyAuth(token);
    const globalUser = await prisma.globalUser.findUnique({
      where: { id: String(payload.userId) },
      select: {
        id: true,
        username: true,
        role: true,
        displayName: true,
        studentId: true,
        email: true,
      },
    });

    if (!globalUser) {
      return null;
    }

    return {
      ...payload,
      userId: globalUser.id,
      username: globalUser.username,
      role: globalUser.role,
      isGlobalAdmin: globalUser.role === "SUPER_ADMIN",
      displayName: globalUser.displayName,
      studentId: globalUser.studentId,
      email: globalUser.email,
    };
  } catch (error) {
    console.log(error);
    return null;
  }
}

// 验证 API Key 并返回关联的用户 (GlobalUser)
export async function validateApiKey(apiKey: string) {
  if (!apiKey) return null;

  const keyRecord = await prisma.apiKey.findUnique({
    where: { key: apiKey },
    include: { user: true },
  });

  if (!keyRecord || !keyRecord.isEnabled) return null;

  // 异步更新最后使用时间，不阻塞主流程
  prisma.apiKey
    .update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => console.error("Failed to update API key usage:", err));

  return keyRecord.user;
}

export async function getCurrentSuper() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) return null;

  return getVerifiedGlobalUser(token);
}
