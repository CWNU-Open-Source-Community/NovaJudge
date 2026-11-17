import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { externalLoginEnabled } from "@/lib/external-login";

export async function GET() {
  const setting = await prisma.systemSetting.findUnique({
    where: { id: "default" },
    select: { allowExternalLogin: true }, // 只返回公开字段
  });

  return NextResponse.json({ allowExternalLogin: externalLoginEnabled(setting) });
}
