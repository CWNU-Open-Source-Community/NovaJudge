"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";

// 生成安全的 API Key
function generateApiKey() {
  // 格式: sk_live_<24位随机字符>
  return `sk_live_${randomBytes(18).toString("hex")}`;
}

export async function getApiKeys() {
  const user = await requireSuperAdmin();

  return await prisma.apiKey.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createApiKey(name: string) {
  const user = await requireSuperAdmin();

  const key = generateApiKey();

  await prisma.apiKey.create({
    data: {
      userId: user.userId,
      key: key,
      name: name || "Untitled Key",
    },
  });

  revalidatePath("/admin/api-keys");
  return { success: true, key };
}

export async function deleteApiKey(id: string) {
  const user = await requireSuperAdmin();

  await prisma.apiKey.delete({
    where: { id, userId: user.userId },
  });

  revalidatePath("/admin/api-keys");
  return { success: true };
}

export async function toggleApiKey(id: string, isEnabled: boolean) {
  const user = await requireSuperAdmin();

  await prisma.apiKey.update({
    where: { id, userId: user.userId },
    data: { isEnabled },
  });

  revalidatePath("/admin/api-keys");
  return { success: true };
}
