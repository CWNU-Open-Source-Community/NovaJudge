import { NextResponse } from "next/server";
import { getCurrentSuper, type UserJwtPayload } from "@/lib/auth";
import { listJudgeWorkers, getJudgeQueueStats } from "@/lib/worker-registry";

// 获取当前所有在线的判题机 + 队列统计（后台首页实时轮询用）
export async function GET() {
  const admin = await getCurrentSuper();
  if (!admin || !(admin as UserJwtPayload).isGlobalAdmin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const [workers, queue] = await Promise.all([
    listJudgeWorkers(),
    getJudgeQueueStats(),
  ]);

  return NextResponse.json({ workers, queue });
}
