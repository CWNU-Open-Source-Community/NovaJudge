"use server";

import { requireContestAccess } from "@/lib/contest-access";

import { getCurrentSuper, getCurrentUser, UserJwtPayload, verifyAuth } from "@/lib/auth";
import { ContestRole, PrintJobStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

const ALLOWED_PRINT_EXTENSIONS = [".cpp", ".c", ".cc", ".cxx", ".java", ".py"];
const MAX_PRINT_CHARS = 100_000;

async function requirePrintManager(contestId: number) {
  await requireContestAccess(contestId);
  const [user, superAdmin] = await Promise.all([
    getCurrentUser(),
    getCurrentSuper(),
  ]);
  const payload = user as UserJwtPayload | null;

  const isContestStaff =
    payload?.contestId === contestId &&
    (payload.role === ContestRole.ADMIN ||
      payload.role === ContestRole.JUDGE ||
      payload.role === ContestRole.PRINT);

  if (!isContestStaff && !superAdmin?.isGlobalAdmin) {
    throw new Error("Only contest staff can manage print jobs.");
  }
}

function getAllowedExtension(filename: string) {
  const lowerName = filename.toLowerCase();
  return ALLOWED_PRINT_EXTENSIONS.find((ext) => lowerName.endsWith(ext));
}

export async function createPrintJob(
  contestId: number,
  language: string,
  code: string,
  sourceFilename?: string,
) {
  await requireContestAccess(contestId);
  try {
    const token = (await cookies()).get("user_token")?.value;
    if (!token) return { error: "Please sign in before printing." };

    const payload = await verifyAuth(token);
    if (payload.contestId !== contestId || payload.role !== ContestRole.TEAM) {
      return { error: "Only contest teams can request code printing." };
    }

    const filename = sourceFilename?.trim() || "pasted-code.txt";
    if (sourceFilename && !getAllowedExtension(filename)) {
      return {
        error: `Only ${ALLOWED_PRINT_EXTENSIONS.join(", ")} files can be printed.`,
      };
    }

    const trimmedCode = code.trimEnd();
    if (!trimmedCode.trim()) return { error: "Code is empty." };
    if (trimmedCode.includes("\0")) {
      return { error: "Binary files cannot be printed." };
    }
    if (trimmedCode.length > MAX_PRINT_CHARS) {
      return { error: "Code is too long to print." };
    }

    await prisma.printJob.create({
      data: {
        contestId,
        userId: payload.userId,
        language,
        code: trimmedCode,
        sourceFilename: filename.slice(0, 255),
      },
    });

    revalidatePath(`/contest/${contestId}/print`);
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to create print job.",
    };
  }
}

export async function markPrintJobPrinting(contestId: number, jobId: number) {
  await requirePrintManager(contestId);
  await prisma.printJob.updateMany({
    where: { id: jobId, contestId },
    data: { status: PrintJobStatus.PRINTING, errorMessage: null },
  });
  revalidatePath(`/contest/${contestId}/print`);
}

export async function markPrintJobPrinted(contestId: number, jobId: number) {
  await requirePrintManager(contestId);
  await prisma.printJob.updateMany({
    where: { id: jobId, contestId },
    data: {
      status: PrintJobStatus.PRINTED,
      errorMessage: null,
      printedAt: new Date(),
    },
  });
  revalidatePath(`/contest/${contestId}/print`);
}

export async function markPrintJobFailed(
  contestId: number,
  jobId: number,
  formData: FormData,
) {
  await requirePrintManager(contestId);
  const reason = String(formData.get("reason") || "Print failed.").slice(0, 500);
  await prisma.printJob.updateMany({
    where: { id: jobId, contestId },
    data: { status: PrintJobStatus.FAILED, errorMessage: reason },
  });
  revalidatePath(`/contest/${contestId}/print`);
}

export async function cancelPrintJob(contestId: number, jobId: number) {
  await requirePrintManager(contestId);
  await prisma.printJob.updateMany({
    where: { id: jobId, contestId },
    data: { status: PrintJobStatus.CANCELLED },
  });
  revalidatePath(`/contest/${contestId}/print`);
}
