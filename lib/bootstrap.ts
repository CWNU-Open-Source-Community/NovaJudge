import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

async function resetIdentitySequence(table: string, column: string) {
  const sql = `SELECT setval(pg_get_serial_sequence('"public"."${table}"','${column}'), (SELECT COALESCE(MAX("${column}"),0)+1 FROM "public"."${table}"), false);`;
  await prisma.$executeRawUnsafe(sql);
}

export async function initSuperAdmin() {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      "⚠️ [Bootstrap] No SUPER_ADMIN_USERNAME or SUPER_ADMIN_PASSWORD in .env, skipping admin creation.",
    );
    return;
  }

  try {
    await resetIdentitySequence("contests", "id");
    await resetIdentitySequence("problems", "id");
    await resetIdentitySequence("balloons", "id");
    await resetIdentitySequence("clarifications", "id");
    await resetIdentitySequence("replies", "id");
    // 1. 检查是否存在任何 GlobalUser
    // 这里也可以改成 findUnique 检查特定用户名是否存在
    const adminCount = await prisma.globalUser.count();

    if (adminCount === 0) {
      console.log(
        "⚡ [Bootstrap] No Global Admin found. Creating default Super Admin...",
      );

      // 2. 加密密码
      const hashedPassword = await bcrypt.hash(password, 10);

      // 3. 创建用户
      await prisma.globalUser.create({
        data: {
          username: username,
          password: hashedPassword,
          role: "SUPER_ADMIN",
        },
      });

      console.log(
        `✅ [Bootstrap] Super Admin created successfully! Username: ${username}`,
      );
    } else {
      // 已经有管理员了，什么都不做
      // console.log("ℹ️ [Bootstrap] Global Admin already exists. Skipping.");
    }
  } catch (error) {
    const err = error as { code?: string };
    if (err?.code === "P2021") {
      console.warn(
        "⚠️ [Bootstrap] Database schema not initialized (table global_users missing). Run `npm run db:deploy` and restart.",
      );
      return;
    }
    console.error("❌ [Bootstrap] Failed to initialize Super Admin:", error);
  }
}
