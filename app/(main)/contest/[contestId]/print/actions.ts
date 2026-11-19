"use server";

import { requireContestAccess } from "@/lib/contest-access";
import { getDictionary } from "@/lib/get-dictionary";
import { formatMessage } from "@/lib/dictionaries";

import { getCurrentSuper, getCurrentUser, UserJwtPayload } from "@/lib/auth";
import { ContestRole, PrintJobStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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
    throw new Error((await getDictionary()).print.manageDenied);
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
  const { print } = await getDictionary();
  try {
    const payload = await getCurrentUser();
    if (!payload) return { error: print.signIn };
    if (payload.contestId !== contestId || payload.role !== ContestRole.TEAM) {
      return { error: print.teamRequired };
    }

    const filename = sourceFilename?.trim() || "pasted-code.txt";
    if (sourceFilename && !getAllowedExtension(filename)) {
      return {
        error: formatMessage(print.allowedError, { extensions: ALLOWED_PRINT_EXTENSIONS.join(", ") }),
      };
    }

    const trimmedCode = code.trimEnd();
    if (!trimmedCode.trim()) return { error: print.emptyCode };
    if (trimmedCode.includes("\0")) {
      return { error: print.binaryFile };
    }
    if (trimmedCode.length > MAX_PRINT_CHARS) {
      return { error: print.codeTooLong };
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
    console.error("Could not create print job", error);
    return { error: print.createFailed };
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
