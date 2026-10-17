import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentSuper } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseSingleProblemArchive, ProblemArchiveError } from "@/lib/problem-archive";
import { replaceProblemFiles, ProblemUpdateBusyError } from "@/lib/problem-update";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getCurrentSuper();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!admin.isGlobalAdmin) {
      return NextResponse.json({ error: "Only admin can perform this action" }, { status: 403 });
    }

    const { id } = await params;
    const problemId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isInteger(problemId) || problemId <= 0 || problemId > 2147483647) {
      return NextResponse.json({ error: "Invalid problem ID." }, { status: 400 });
    }
    const existing = await prisma.problem.findUnique({ where: { id: problemId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Problem not found." }, { status: 404 });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Upload one ZIP file containing exactly one problem." }, { status: 400 });
    }
    const file = formData.get("file");
    const uploadedFiles = Array.from(formData.values()).filter((value) => value instanceof File);
    if (!(file instanceof File) || uploadedFiles.length !== 1 || formData.getAll("file").length !== 1 ||
        !file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Upload one ZIP file containing exactly one problem." }, { status: 400 });
    }

    // Parsing and validation finish before either the database or existing files change.
    const archive = await parseSingleProblemArchive(await file.arrayBuffer(), problemId);
    const problem = await replaceProblemFiles(problemId, archive.files, () => prisma.problem.update({
      where: { id: problemId },
      data: { ...archive.data, judgeConfig: archive.data.judgeConfig ?? Prisma.DbNull },
      select: { id: true, title: true },
    }));

    revalidatePath("/admin/problems");
    revalidatePath(`/admin/problems/${problemId}`, "layout");
    revalidatePath("/contest/[contestId]", "layout");
    return NextResponse.json({ success: true, problem });
  } catch (error) {
    if (error instanceof ProblemArchiveError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ProblemUpdateBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Problem update failed", error);
    return NextResponse.json({ error: "Failed to update the problem. Please try again." }, { status: 500 });
  }
}
