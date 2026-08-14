import { NextResponse } from "next/server";
import { getCurrentSuper, type UserJwtPayload } from "@/lib/auth";
import { getMonitorStats } from "@/lib/monitor";

// 监控仪表盘轮询接口：队列 + 判题机 + 提交活跃度
export async function GET() {
  const admin = await getCurrentSuper();
  if (!admin || !(admin as UserJwtPayload).isGlobalAdmin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.json(await getMonitorStats());
}
