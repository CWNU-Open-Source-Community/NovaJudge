"use server";

import { requireSuperAdmin } from "@/lib/admin-auth";
import fs from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "problems");

function getAssetsDir(problemId: number) {
  return path.join(UPLOAD_ROOT, problemId.toString(), "assets");
}

export async function getAssets(problemId: number) {
  await requireSuperAdmin();
  const dir = getAssetsDir(problemId);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    return [];
  }

  const files = await fs.readdir(dir);
  // 返回文件名和访问用的相对 URL
  return files.map((file) => ({
    name: file,
    url: `/api/problems/${problemId}/assets/${file}`,
    isImage: /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file),
  }));
}

export async function uploadAsset(problemId: number, formData: FormData) {
  await requireSuperAdmin();
  const dir = getAssetsDir(problemId);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  const file = formData.get("file") as File;
  if (!file) return;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 防止文件名冲突或路径遍历，只移除危险字符，保留中文字符
  const safeName = path.basename(file.name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

  await fs.writeFile(path.join(dir, safeName), buffer);
  revalidatePath(`/admin/problems/${problemId}`); // 刷新页面
}

export async function deleteAsset(problemId: number, fileName: string) {
  await requireSuperAdmin();
  const dir = getAssetsDir(problemId);
  await fs.unlink(path.join(dir, fileName));
  revalidatePath(`/admin/problems/${problemId}`);
}
