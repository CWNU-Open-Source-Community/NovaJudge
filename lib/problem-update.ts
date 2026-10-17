import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "problems");

export class ProblemUpdateBusyError extends Error {
  constructor() {
    super("This problem is already being updated. Please try again shortly.");
    this.name = "ProblemUpdateBusyError";
  }
}

/** Install a complete package, restoring the previous files if saving the problem fails. */
export async function replaceProblemFiles<T>(
  problemId: number,
  files: ReadonlyMap<string, Buffer>,
  saveProblem: () => Promise<T>,
  uploadRoot = UPLOAD_ROOT,
): Promise<T> {
  if (!Number.isInteger(problemId) || problemId <= 0 || problemId > 2147483647) {
    throw new Error("Invalid problem ID.");
  }
  const root = path.resolve(uploadRoot);
  function insideRoot(candidate: string) {
    const resolved = path.resolve(candidate);
    const relative = path.relative(root, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Refusing to modify a directory outside problem uploads.");
    }
    return resolved;
  }
  async function removeDirectory(candidate: string) {
    await fs.rm(insideRoot(candidate), { recursive: true, force: true });
  }
  async function moveDirectory(from: string, to: string) {
    await fs.rename(insideRoot(from), insideRoot(to));
  }

  await fs.mkdir(root, { recursive: true });
  const target = insideRoot(path.join(root, String(problemId)));
  const lock = insideRoot(path.join(root, `.update-${problemId}.lock`));
  // The shared uploads directory also serializes requests from different web processes.
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ProblemUpdateBusyError();
    throw error;
  }

  let staging: string | undefined;
  let backup: string | undefined;
  let backedUp = false;
  let installed = false;
  let saved = false;
  try {
    staging = await fs.mkdtemp(path.join(root, `.update-${problemId}-`));
    backup = `${staging}-previous`;
    await fs.mkdir(path.join(staging, "data"));
    await fs.mkdir(path.join(staging, "assets"));
    for (const [name, content] of files) {
      // The parser supplies flat data/assets paths; check again at the write boundary.
      if (!/^(data|assets)\/[^/\\]+$/.test(name) || name.endsWith("/.") || name.endsWith("/..") || /[:\0]/.test(name)) {
        throw new Error("Invalid problem file path.");
      }
      await fs.writeFile(insideRoot(path.join(staging, ...name.split("/"))), content, { flag: "wx" });
    }

    try {
      await moveDirectory(target, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await moveDirectory(staging, target);
    installed = true;
    const result = await saveProblem();
    saved = true;
    return result;
  } catch (error) {
    if (installed) await removeDirectory(target);
    if (backedUp && backup) await moveDirectory(backup, target);
    throw error;
  } finally {
    // Cleanup failures must not turn a successful database update into an apparent failure.
    // Keep the backup if recovery itself failed, so its files remain recoverable.
    for (const candidate of [staging, saved && backedUp ? backup : undefined, lock]) {
      if (candidate) {
        await removeDirectory(candidate).catch((error) => {
          console.error(`Failed to clean up problem update directory ${candidate}`, error);
        });
      }
    }
  }
}
