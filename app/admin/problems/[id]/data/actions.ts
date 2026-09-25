"use server";

import { promises as fs } from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  normalizeJudgeDataFileName,
  normalizeProblemJudgeConfig,
  resolveJudgeDataPath,
  type ProblemJudgeConfig,
} from "@/lib/problem-judge-config";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "problems");

function getDataDir(problemId: number) {
  if (!Number.isSafeInteger(problemId) || problemId <= 0) {
    throw new Error(`Invalid problemId: ${problemId}`);
  }
  return path.join(UPLOAD_ROOT, problemId.toString(), "data");
}

const naturalSort = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
};

async function listDataFiles(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function getProblemType(problemId: number) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    select: { type: true },
  });
  if (!problem) throw new Error("Problem not found.");
  return problem.type;
}

async function readOptionalYaml(dir: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(dir, "problem.yml"), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function jsonConfig(config: ProblemJudgeConfig): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonObject;
}

async function removeUploadDirectory(dir: string) {
  const resolved = path.resolve(dir);
  const relative = path.relative(path.resolve(UPLOAD_ROOT), resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    throw new Error("Refusing to remove a directory outside problem uploads.");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

// 1. 获取数据
export async function getProblemData(problemId: number) {
  const dir = getDataDir(problemId);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  const files = await listDataFiles(dir);
  const fileStats = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(path.join(dir, file));
      return { name: file, size: stat.size, updatedAt: stat.mtime };
    }),
  );

  fileStats.sort((a, b) => naturalSort(a.name, b.name));

  const yamlPath = path.join(dir, "problem.yml");
  let yamlContent = "";
  try {
    yamlContent = await fs.readFile(yamlPath, "utf-8");
  } catch {
    yamlContent = "";
    await fs.writeFile(yamlPath, yamlContent);
  }

  return {
    files: fileStats.filter((f) => f.name !== "problem.yml"),
    yamlContent,
  };
}

// 2. 保存 YAML
export async function saveYamlConfig(problemId: number, content: string) {
  const dir = getDataDir(problemId);
  const currentType = await getProblemType(problemId);
  await fs.mkdir(dir, { recursive: true });
  const { type, config } = normalizeProblemJudgeConfig(yaml.load(content), {
    currentType,
    files: await listDataFiles(dir),
    autoDetect: true,
  });
  const normalizedYaml = yaml.dump(config);
  const judgeConfig = jsonConfig(config);
  const originalYaml = await readOptionalYaml(dir);
  const yamlPath = path.join(dir, "problem.yml");
  const temporary = path.join(dir, `.problem-${randomUUID()}.yml`);
  await fs.writeFile(temporary, normalizedYaml);
  try {
    await fs.rename(temporary, yamlPath);
    await prisma.problem.update({
      where: { id: problemId },
      data: { type, judgeConfig },
    });
  } catch (error) {
    if (originalYaml === undefined) await fs.rm(yamlPath, { force: true });
    else await fs.writeFile(yamlPath, originalYaml);
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  revalidatePath(`/admin/problems/${problemId}/data`);
  revalidatePath("/admin/problems");
  return normalizedYaml;
}

// 3. 上传文件
export async function uploadFiles(problemId: number, formData: FormData) {
  const dir = getDataDir(problemId);
  const currentType = await getProblemType(problemId);
  const currentYaml = await readOptionalYaml(dir);
  const uploaded = new Map<string, Buffer>();
  const seenNames = new Set<string>();
  function addFile(original: string, buffer: Buffer) {
    // Keep the existing flat data layout, but reject traversal and collisions.
    const relative = normalizeJudgeDataFileName(original);
    const name = path.posix.basename(relative);
    if (name.startsWith(".") || relative.split("/").includes("__MACOSX")) return;
    if (seenNames.has(name.toLowerCase())) throw new Error(`Duplicate uploaded file: ${name}`);
    seenNames.add(name.toLowerCase());
    uploaded.set(name, buffer);
  }
  for (const value of formData.values()) {
    if (!(value instanceof File)) continue;
    if (value.name.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await value.arrayBuffer());
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        // JSZip removes ../ segments; check the original path before flattening.
        const original = (entry as typeof entry & { unsafeOriginalName?: string })
          .unsafeOriginalName || entry.name;
        addFile(original, await entry.async("nodebuffer"));
      }
    } else {
      addFile(value.name, Buffer.from(await value.arrayBuffer()));
    }
  }
  if (!uploaded.size) throw new Error("No data files were uploaded.");
  const sourceYaml = uploaded.get("problem.yml")?.toString("utf-8") ?? currentYaml ?? "";
  const { type, config } = normalizeProblemJudgeConfig(yaml.load(sourceYaml), {
    currentType,
    files: uploaded.keys(),
    autoDetect: true,
  });
  const newYaml = yaml.dump(config);
  const judgeConfig = jsonConfig(config);
  uploaded.set("problem.yml", Buffer.from(newYaml));

  // Validate and fully write a staging directory before replacing any old data.
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(dir), ".data-upload-"));
  const backup = `${staging}-previous`;
  let backedUp = false;
  let installed = false;
  try {
    for (const [name, buffer] of uploaded) {
      await fs.writeFile(resolveJudgeDataPath(staging, name), buffer);
    }
    try {
      await fs.rename(dir, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(staging, dir);
    installed = true;
    await prisma.problem.update({
      where: { id: problemId },
      data: { type, judgeConfig },
    });
  } catch (error) {
    if (installed) await removeUploadDirectory(dir);
    if (backedUp) await fs.rename(backup, dir);
    throw error;
  } finally {
    await removeUploadDirectory(staging);
  }
  if (backedUp) await removeUploadDirectory(backup);
  revalidatePath(`/admin/problems/${problemId}/data`);
  revalidatePath("/admin/problems");
  return newYaml;
}

// 4. 删除文件
export async function deleteFile(problemId: number, fileName: string) {
  const filePath = resolveJudgeDataPath(getDataDir(problemId), fileName);
  try {
    await fs.unlink(filePath);
  } catch {}
  revalidatePath(`/admin/problems/${problemId}/data`);
}

// 【新增】读取文件内容
export async function getFileContent(problemId: number, fileName: string) {
  const filePath = resolveJudgeDataPath(getDataDir(problemId), fileName);
  try {
    // 限制读取文件大小，防止读取过大的数据文件导致崩盘 (例如限制 20MB)
    const stat = await fs.stat(filePath);
    if (stat.size > 1024 * 1024 * 20) {
      return "Error: File is too large to preview (limit 20MB).";
    }
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch (e) {
    console.error(`Read file ${fileName} failed`, e);
    return "Error: Failed to read file.";
  }
}

// 【新增】保存文件内容
export async function saveFileContent(
  problemId: number,
  fileName: string,
  content: string,
) {
  const dir = getDataDir(problemId);
  if (fileName === "problem.yml") {
    await saveYamlConfig(problemId, content);
    return;
  }
  const filePath = resolveJudgeDataPath(dir, fileName);

  await fs.writeFile(filePath, content);
  revalidatePath(`/admin/problems/${problemId}/data`);
}
