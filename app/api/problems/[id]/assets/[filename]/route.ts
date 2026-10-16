import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import mime from "mime"; // 需要安装 npm install mime @types/mime
import { getCurrentSuper } from "@/lib/auth";
import { hasContestAccess } from "@/lib/contest-access";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;
  const problemId = Number(id);

  // 安全检查：防止 ../ 路径遍历
  if (!Number.isSafeInteger(problemId) || problemId <= 0 ||
      !filename || filename.includes("..") || /[\\/:\0]/.test(filename)) {
    return new NextResponse("Invalid filename", { status: 400 });
  }

  const admin = await getCurrentSuper();
  if (!admin?.isGlobalAdmin) {
    const links = await prisma.contestProblem.findMany({
      where: { problemId },
      select: { contestId: true, contest: { select: { type: true } } },
    });
    // Reused public problems remain public. Unassigned/private-only assets
    // must never be readable just by guessing their raw problem ID.
    let allowed = links.some((link) => link.contest.type === "PUBLIC");
    if (!allowed) {
      for (const link of links) {
        if (await hasContestAccess(link.contestId)) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) {
      return new NextResponse("Forbidden", {
        status: 403, headers: { "Cache-Control": "private, no-store" },
      });
    }
  }

  const filePath = path.join(
    process.cwd(),
    "uploads",
    "problems",
    String(problemId),
    "assets",
    filename,
  );

  try {
    const fileBuffer = await fs.readFile(filePath);
    const mimeType = mime.getType(filePath) || "application/octet-stream";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.log(e);
    return new NextResponse("File not found", { status: 404 });
  }
}
