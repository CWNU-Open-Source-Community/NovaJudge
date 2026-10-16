"use server";

import { prisma } from "@/lib/prisma";
import { ContestStatus, ContestType } from "@/lib/generated/prisma/client";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import path from "node:path";
import { requireSuperAdmin } from "@/lib/admin-auth";

type ContestConfig = {
  frozenDuration?: number;
  unfreezeDelay?: number;
  editorialPdf?: {
    filename: string;
    uploadedAt: string;
  };
  medal?: {
    mode: "ratio" | "fixed";
    gold: number;
    silver: number;
    bronze: number;
  };
};

const MAX_EDITORIAL_PDF_BYTES = 50 * 1024 * 1024;

function getContestUploadDir(contestId: number) {
  return path.join(process.cwd(), "uploads", "contests", contestId.toString());
}

function getEditorialPdfPath(contestId: number) {
  return path.join(getContestUploadDir(contestId), "editorial.pdf");
}

export async function updateContest(contestId: number, formData: FormData) {
  await requireSuperAdmin();
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const startTimeStr = formData.get("startTime") as string;
  const endTimeStr = formData.get("endTime") as string;
  const type = formData.get("type") as ContestType;
  const password = formData.get("password") as string;
  const visible = formData.get("visible") === "true";

  // --- 解析 Config 配置 ---
  const frozenDuration = Number(formData.get("frozenDuration") || 0);
  const unfreezeDelay = Number(formData.get("unfreezeDelay") || 300);

  const medalMode = formData.get("medalMode") as "ratio" | "fixed";
  const gold = Number(formData.get("medal_gold") || 0);
  const silver = Number(formData.get("medal_silver") || 0);
  const bronze = Number(formData.get("medal_bronze") || 0);
  const editorialPdf = formData.get("editorialPdf") as File | null;
  const removeEditorialPdf = formData.get("removeEditorialPdf") === "true";

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { config: true },
  });

  if (!contest) {
    return { error: "Contest not found" };
  }

  const previousConfig = (contest.config as ContestConfig | null) || {};
  const config: ContestConfig = {
    ...previousConfig,
    frozenDuration,
    unfreezeDelay,
    medal: {
      mode: medalMode,
      gold,
      silver,
      bronze,
    },
  };

  // --- 校验 ---
  if (type === ContestType.PRIVATE && !password?.trim()) {
    return { error: "私有赛必须设置比赛密码。" };
  }
  if (!title || !startTimeStr || !endTimeStr) {
    return { error: "Missing required fields" };
  }

  const startTime = new Date(startTimeStr);
  const endTime = new Date(endTimeStr);

  if (endTime <= startTime) {
    return { error: "End time must be after start time" };
  }

  const now = new Date();
  let newStatus: ContestStatus;

  if (now < startTime) {
    newStatus = ContestStatus.PENDING;
  } else if (now >= startTime && now < endTime) {
    newStatus = ContestStatus.RUNNING;
  } else {
    newStatus = ContestStatus.ENDED;
  }

  try {
    if (removeEditorialPdf) {
      try {
        await fs.unlink(getEditorialPdfPath(contestId));
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw error;
      }
      delete config.editorialPdf;
    }

    if (editorialPdf && editorialPdf.size > 0) {
      if (editorialPdf.type && editorialPdf.type !== "application/pdf") {
        return { error: "Only PDF files can be uploaded as editorial." };
      }

      if (!editorialPdf.name.toLowerCase().endsWith(".pdf")) {
        return { error: "Only .pdf files can be uploaded as editorial." };
      }

      if (editorialPdf.size > MAX_EDITORIAL_PDF_BYTES) {
        return { error: "Editorial PDF must be 50MB or smaller." };
      }

      const dir = getContestUploadDir(contestId);
      await fs.mkdir(dir, { recursive: true });
      const buffer = Buffer.from(await editorialPdf.arrayBuffer());
      await fs.writeFile(getEditorialPdfPath(contestId), buffer);
      config.editorialPdf = {
        filename: "editorial.pdf",
        uploadedAt: new Date().toISOString(),
      };
    }

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        title,
        description,
        startTime,
        endTime,
        type,
        password: password || null,
        visible,
        config: config,
        status: newStatus,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: e.message || "Failed to update contest" };
  }

  revalidatePath("/admin/contests");
  revalidatePath("/");
  revalidatePath("/train");
  revalidatePath(`/contest/${contestId}`, "layout");
  revalidatePath(`/admin/contests/${contestId}`);
  revalidatePath(`/admin/contests/${contestId}/edit`);
  revalidatePath(`/contest/${contestId}/editorial`);
  revalidatePath(`/api/contests/${contestId}/editorial`);
  redirect("/admin/contests");
}
