import JSZip from "jszip";
import type { Prisma } from "./generated/prisma/client";
import { isProblemType, normalizeJudgeDataFileName } from "./problem-judge-config";
import { normalizeProblemSamples, type ProblemSample } from "./problem-samples";

export class ProblemArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProblemArchiveError";
  }
}

export interface SingleProblemArchive {
  data: {
    title: string;
    type: string;
    defaultTimeLimit: number;
    defaultMemoryLimit: number;
    sections: { title: string; content: string }[];
    samples: ProblemSample[];
    hint: string | null;
    judgeConfig: Prisma.InputJsonValue | null;
  };
  files: Map<string, Buffer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new ProblemArchiveError(`${label} must be a positive 32-bit integer.`);
  }
  return value;
}

function archivePath(name: string, directory: boolean) {
  // JSZip sanitizes traversal in entry.name; callers also validate unsafeOriginalName.
  return normalizeJudgeDataFileName(directory ? name.replace(/[/\\]+$/, "") : name);
}

/** Parse and validate a complete replacement without changing the database or filesystem. */
export async function parseSingleProblemArchive(
  buffer: ArrayBuffer | Buffer,
  targetId: number,
): Promise<SingleProblemArchive> {
  positiveInt(targetId, "Target problem ID");
  const zip = new JSZip();
  // JSZip otherwise overwrites duplicate ZIP records, hiding extra metadata/files from validation.
  zip.files = new Proxy(zip.files, {
    set(files, name: string, entry: JSZip.JSZipObject) {
      if (Object.hasOwn(files, name)) throw new ProblemArchiveError(`Duplicate archive path: ${name}`);
      files[name] = entry;
      return true;
    },
  });
  try {
    await zip.loadAsync(buffer, { checkCRC32: true });
  } catch (error) {
    if (error instanceof ProblemArchiveError) throw error;
    throw new ProblemArchiveError("Invalid or damaged ZIP archive.");
  }

  const entries: { name: string; entry: JSZip.JSZipObject }[] = [];
  const paths = new Map<string, boolean>();
  try {
    for (const entry of Object.values(zip.files)) {
      const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
      if (originalName !== undefined) archivePath(originalName, entry.dir);
      const name = archivePath(entry.name, entry.dir);
      const key = name.toLowerCase();
      if (paths.has(key)) throw new Error(`Duplicate archive path: ${name}`);
      paths.set(key, entry.dir);
      entries.push({ name, entry });
    }
    for (const { name } of entries) {
      const parts = name.toLowerCase().split("/");
      for (let index = 1; index < parts.length; index++) {
        if (paths.get(parts.slice(0, index).join("/")) === false) {
          throw new Error(`A file conflicts with an archive directory: ${name}`);
        }
      }
    }
  } catch (error) {
    throw new ProblemArchiveError(`Invalid archive path: ${(error as Error).message}`);
  }

  // Count metadata files themselves, including root files and ZIPs without directory records.
  const problems = entries.filter(({ name, entry }) => !entry.dir && name.split("/").pop() === "problem.json");
  if (problems.length !== 1) {
    throw new ProblemArchiveError(`The ZIP archive must contain exactly one problem.json file; found ${problems.length}.`);
  }
  const problem = problems[0];
  const prefix = problem.name.slice(0, -"problem.json".length);
  let source: unknown;
  try {
    source = JSON.parse(await problem.entry.async("text"), (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite JSON number.");
      return value;
    });
  } catch {
    throw new ProblemArchiveError("problem.json must contain valid JSON.");
  }
  if (!isRecord(source)) throw new ProblemArchiveError("problem.json must contain a JSON object.");
  if (typeof source.title !== "string" || !source.title.trim()) {
    throw new ProblemArchiveError("Problem title must be non-empty text.");
  }
  if (!isProblemType(source.type)) throw new ProblemArchiveError("Invalid problem type.");
  const defaultTimeLimit = positiveInt(source.defaultTimeLimit, "Time limit");
  const defaultMemoryLimit = positiveInt(source.defaultMemoryLimit, "Memory limit");
  const sourceId = source.id === undefined ? undefined : positiveInt(source.id, "Exported problem ID");
  const remap = (text: string) => sourceId === undefined ? text
    : text.replaceAll(`/api/problems/${sourceId}/`, `/api/problems/${targetId}/`);
  if (!Array.isArray(source.sections)) throw new ProblemArchiveError("Problem sections must be an array.");
  const sections = source.sections.map((section: unknown, index) => {
    if (!isRecord(section) || typeof section.title !== "string" || typeof section.content !== "string") {
      throw new ProblemArchiveError(`Section ${index + 1} must contain a text title and content.`);
    }
    return { title: remap(section.title), content: remap(section.content) };
  });
  let samples: ProblemSample[];
  try {
    samples = normalizeProblemSamples(source.samples);
  } catch (error) {
    throw new ProblemArchiveError((error as Error).message);
  }
  if (source.hint != null && typeof source.hint !== "string") {
    throw new ProblemArchiveError("Problem hint must be text or null.");
  }
  if (source.judgeConfig != null && typeof source.judgeConfig !== "string" && !isRecord(source.judgeConfig)) {
    throw new ProblemArchiveError("Judge configuration must be an object, text, or null.");
  }

  const files = new Map<string, Buffer>();
  const extractedNames = new Set<string>();
  for (const { name, entry } of entries) {
    if (!name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    const [directory] = relative.split("/");
    if (directory !== "data" && directory !== "assets") continue;
    if (entry.dir) continue;
    if (relative === directory) throw new ProblemArchiveError(`${directory} must be a directory.`);
    // Match the existing export/import layout: nested package files become flat data/assets files.
    const destination = `${directory}/${relative.split("/").pop()}`;
    const key = destination.toLowerCase();
    if (extractedNames.has(key)) throw new ProblemArchiveError(`Duplicate extracted filename: ${destination}`);
    extractedNames.add(key);
    try {
      files.set(destination, await entry.async("nodebuffer"));
    } catch {
      throw new ProblemArchiveError(`Could not read archive file: ${name}`);
    }
  }
  return {
    data: {
      title: source.title,
      type: source.type,
      defaultTimeLimit,
      defaultMemoryLimit,
      sections,
      samples,
      hint: source.hint == null ? null : remap(source.hint as string),
      judgeConfig: (source.judgeConfig ?? null) as Prisma.InputJsonValue | null,
    },
    files,
  };
}
