
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSuper, UserJwtPayload } from "@/lib/auth";
import {
  getManagedEnvSettings,
  updateManagedEnvSettings,
} from "@/lib/env-settings";

export async function GET() {
  const admin = await getCurrentSuper();
  if (!admin || (admin as UserJwtPayload).isGlobalAdmin !== true) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 获取设置，如果不存在则创建默认值
  let setting = await prisma.systemSetting.findUnique({
    where: { id: "default" },
  });

  if (!setting) {
    setting = await prisma.systemSetting.create({
      data: { id: "default" },
    });
  }

  const envSettings = await getManagedEnvSettings();

  return NextResponse.json({
    ...setting,
    envSettings,
  });
}

export async function PUT(req: NextRequest) {
  const admin = await getCurrentSuper();
  if (!admin || (admin as UserJwtPayload).isGlobalAdmin !== true) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();
    const { allowExternalLogin, envSettings } = body;

    const setting = await prisma.systemSetting.upsert({
      where: { id: "default" },
      update: {
        ...(typeof allowExternalLogin === "boolean"
          ? { allowExternalLogin }
          : {}),
      },
      create: {
        id: "default",
        allowExternalLogin:
          typeof allowExternalLogin === "boolean" ? allowExternalLogin : false,
      },
    });

    const nextEnvSettings =
      envSettings && typeof envSettings === "object"
        ? await updateManagedEnvSettings(envSettings)
        : await getManagedEnvSettings();

    return NextResponse.json({
      ...setting,
      envSettings: nextEnvSettings,
    });
  } catch (e) {
    console.error(e);
    return new NextResponse("Error updating settings", { status: 500 });
  }
}
