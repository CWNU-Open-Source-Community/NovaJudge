"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ContestRole } from "@/lib/generated/prisma/client";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { normalizeIp } from "@/lib/request-ip";

export interface ImportUsersData {
  password?: string;
  username: string;
  displayName?: string;
  school?: string;
  members?: string;
  seat?: string;
  autoLoginIp?: string;
  role?: string;
  coach?: string;
  category?: string;
}

export interface UpdateUsersData {
  username?: string;
  displayName?: string;
  password?: string;
  plainPassword?: string;
  school?: string | null;
  members?: string | null;
  seat?: string | null;
  autoLoginIp?: string | null;
  role?: ContestRole;
  coach?: string | null;
  category?: string | null;
}

function normalizeAutoLoginIp(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;

  const ip = normalizeIp(raw);
  if (!ip) {
    throw new Error(`Invalid auto login IP: ${raw}`);
  }

  return ip;
}

async function assertAutoLoginIpAvailable(
  contestId: number,
  autoLoginIp: string | null,
  excludeUserId?: string,
) {
  if (!autoLoginIp) return;

  const existing = await prisma.user.findFirst({
    where: {
      contestId,
      autoLoginIp,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { username: true },
  });

  if (existing) {
    throw new Error(
      `Auto login IP ${autoLoginIp} is already bound to ${existing.username}.`,
    );
  }
}

// 获取用户列表 (根据角色分组)
export async function getContestUsers(
  contestId: number,
  type: "TEAM" | "STAFF"
) {
  await requireSuperAdmin();
  const roles =
    type === "TEAM"
      ? [ContestRole.TEAM]
      : [
          ContestRole.JUDGE,
          ContestRole.BALLOON,
          ContestRole.PRINT,
          ContestRole.OBSERVER,
          ContestRole.ADMIN,
        ];

  return await prisma.user.findMany({
    where: {
      contestId,
      role: { in: roles },
    },
    orderBy: { username: "asc" },
  });
}

// 核心：导入用户
export async function importUsers(
  contestId: number,
  usersData: ImportUsersData[], // 解析后的 JSON 数据
  roleType: "TEAM" | "STAFF"
) {
  await requireSuperAdmin();
  const dataToInsert = [];
  const batchAutoLoginIps = new Map<string, string>();

  if (roleType === "TEAM") {
    for (const user of usersData) {
      const autoLoginIp = normalizeAutoLoginIp(user.autoLoginIp);
      if (!autoLoginIp) continue;

      const previousUsername = batchAutoLoginIps.get(autoLoginIp);
      if (previousUsername) {
        throw new Error(
          `Auto login IP ${autoLoginIp} is duplicated by ${previousUsername} and ${user.username}.`,
        );
      }

      batchAutoLoginIps.set(autoLoginIp, user.username);
    }

    const ips = Array.from(batchAutoLoginIps.keys());
    if (ips.length > 0) {
      const existing = await prisma.user.findFirst({
        where: {
          contestId,
          autoLoginIp: { in: ips },
        },
        select: { username: true, autoLoginIp: true },
      });

      if (existing?.autoLoginIp) {
        throw new Error(
          `Auto login IP ${existing.autoLoginIp} is already bound to ${existing.username}.`,
        );
      }
    }
  }

  for (const user of usersData) {
    // 1. 处理密码 (如果没有密码，生成随机的)
    const rawPassword =
      user.password && user.password.trim() !== ""
        ? user.password
        : Math.random().toString(36).slice(-8);

    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    // 2. 构造数据对象
    const baseData = {
      contestId,
      username: user.username,
      password: hashedPassword,
      plainPassword: rawPassword,
      displayName: user.displayName || user.username,
    };

    if (roleType === "TEAM") {
      dataToInsert.push({
        ...baseData,
        role: ContestRole.TEAM,
        school: user.school || null,
        members: user.members || null,
        seat: user.seat || null,
        coach: user.coach || null,
        category: user.category || "0",
        autoLoginIp: normalizeAutoLoginIp(user.autoLoginIp),
      });
    } else {
      // 员工角色映射
      let role: ContestRole = ContestRole.TEAM; // 默认
      if (user.role) {
        const r = user.role.toUpperCase();
        if (["JUDGE", "BALLOON", "PRINT", "OBSERVER", "ADMIN"].includes(r)) {
          role = r as ContestRole;
        }
      }

      dataToInsert.push({
        ...baseData,
        role: role,
      });
    }
  }

  // 3. 批量插入 (忽略重名，或者你可以选择抛错)
  await prisma.user.createMany({
    data: dataToInsert,
    skipDuplicates: true,
  });

  revalidatePath(`/admin/contests/${contestId}/users`);
}

// 更新用户
export async function updateUser(
  userId: string,
  contestId: number,
  data: {
    displayName?: string;
    password?: string;
    school?: string;
    members?: string;
    seat?: string;
    role?: ContestRole;
    coach?: string; 
    category?: string;
    autoLoginIp?: string | null;
  }
) {
  await requireSuperAdmin();
  const updateData: UpdateUsersData = {};
  const normalizedAutoLoginIp = normalizeAutoLoginIp(data.autoLoginIp);

  if (data.displayName) updateData.displayName = data.displayName;
  if (data.school !== undefined) updateData.school = data.school;
  if (data.members !== undefined) updateData.members = data.members;
  if (data.seat !== undefined) updateData.seat = data.seat;
  if (data.role) updateData.role = data.role;
  if (data.coach !== undefined) updateData.coach = data.coach;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.autoLoginIp !== undefined) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (normalizedAutoLoginIp && currentUser?.role !== ContestRole.TEAM) {
      throw new Error("Auto login IP can only be bound to TEAM users.");
    }

    await assertAutoLoginIpAvailable(contestId, normalizedAutoLoginIp, userId);
    updateData.autoLoginIp = normalizedAutoLoginIp;
  }

  // 如果修改了密码，同时更新 Hash 和 明文
  if (data.password && data.password.trim() !== "") {
    const raw = data.password.trim();
    updateData.password = await bcrypt.hash(raw, 10);
    updateData.plainPassword = raw;
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  revalidatePath(`/admin/contests/${contestId}/users`);
}

// 删除用户
export async function deleteUser(userId: string, contestId: number) {
  await requireSuperAdmin();
  await prisma.user.delete({
    where: {
      id: userId,
    },
  });

  revalidatePath(`/admin/contests/${contestId}/users`);
}

// 批量删除用户
export async function deleteUsers(userIds: string[], contestId: number) {
  await requireSuperAdmin();
  if (!userIds.length) return;

  await prisma.user.deleteMany({
    where: {
      id: { in: userIds },
      contestId: contestId, // 确保只删除本场比赛的用户
    },
  });

  revalidatePath(`/admin/contests/${contestId}/users`);
}
