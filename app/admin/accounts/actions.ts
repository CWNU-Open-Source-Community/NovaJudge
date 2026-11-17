"use server";

import { getCurrentSuper } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const EXTERNAL_ACCOUNTS_PAGE_SIZE = 20;

type ExternalAccountStatusFilter = "all" | "active" | "banned";

function normalizeStatusFilter(status?: string): ExternalAccountStatusFilter {
  if (status === "active" || status === "banned") {
    return status;
  }

  return "all";
}

function buildExternalAccountWhere(
  query?: string,
  status?: string,
): Prisma.GlobalUserWhereInput {
  const normalizedQuery = query?.trim();
  const normalizedStatus = normalizeStatusFilter(status);
  const where: Prisma.GlobalUserWhereInput = {
    role: "GLOBAL_USER",
    externalId: { not: null },
  };

  if (normalizedStatus === "active") {
    where.isBanned = false;
  }

  if (normalizedStatus === "banned") {
    where.isBanned = true;
  }

  if (normalizedQuery) {
    where.OR = [
      {
        username: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        displayName: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        studentId: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        externalId: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
    ];
  }

  return where;
}

async function requireGlobalAdmin() {
  const admin = await getCurrentSuper();

  if (!admin?.isGlobalAdmin) {
    throw new Error("Unauthorized");
  }

  return admin;
}

export async function getExternalAccounts(options: {
  page?: number;
  pageSize?: number;
  query?: string;
  status?: string;
}) {
  await requireGlobalAdmin();

  const page = Math.max(1, options.page || 1);
  const pageSize = options.pageSize || EXTERNAL_ACCOUNTS_PAGE_SIZE;
  const query = options.query?.trim() || "";
  const status = normalizeStatusFilter(options.status);
  const where = buildExternalAccountWhere(query, status);

  const [accounts, total, totalAccounts, bannedAccounts] = await Promise.all([
    prisma.globalUser.findMany({
      where,
      orderBy: [{ isBanned: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        username: true,
        displayName: true,
        studentId: true,
        email: true,
        externalId: true,
        isBanned: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            submissions: true,
          },
        },
      },
    }),
    prisma.globalUser.count({ where }),
    prisma.globalUser.count({
      where: {
        role: "GLOBAL_USER",
        externalId: { not: null },
      },
    }),
    prisma.globalUser.count({
      where: {
        role: "GLOBAL_USER",
        externalId: { not: null },
        isBanned: true,
      },
    }),
  ]);

  return {
    accounts,
    total,
    page,
    pageSize,
    query,
    status,
    summary: {
      total: totalAccounts,
      banned: bannedAccounts,
      active: totalAccounts - bannedAccounts,
    },
  };
}

export async function setExternalAccountBanStatus(
  userId: string,
  isBanned: boolean,
) {
  await requireGlobalAdmin();

  const account = await prisma.globalUser.findFirst({
    where: {
      id: userId,
      role: "GLOBAL_USER",
      externalId: { not: null },
    },
    select: {
      id: true,
      username: true,
      isBanned: true,
    },
  });

  if (!account) {
    throw new Error("External account not found");
  }

  if (account.isBanned !== isBanned) {
    await prisma.globalUser.update({
      where: { id: account.id },
      data: { isBanned },
    });
  }

  revalidatePath("/admin/accounts");

  return {
    success: true,
    username: account.username,
    isBanned,
  };
}
