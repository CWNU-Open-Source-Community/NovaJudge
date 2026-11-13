import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "./generated/prisma/client";
import type { PolygonProblem } from "./polygon-archive";
import { POLYGON_ASSET_PREFIX } from "./polygon-statement";

/** Import into the problem bank only; administrators create contests and choose their problems separately. */
export async function savePolygonImport(
  database: Pick<PrismaClient, "$transaction">,
  problems: (PolygonProblem & { displayId?: string })[],
  uploadRoot = path.join(process.cwd(), "uploads", "problems"),
) {
  const root = path.resolve(uploadRoot);
  const createdDirectories: string[] = [];
  function insideRoot(candidate: string) {
    const resolved = path.resolve(candidate);
    const relative = path.relative(root, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Invalid Polygon import destination.");
    }
    return resolved;
  }
  try {
    await fs.mkdir(root, { recursive: true });
    return await database.$transaction(async (tx) => {
      const importedProblems: { id: number; title: string; displayId?: string }[] = [];
      for (const { archive, displayId } of problems) {
        const problem = await tx.problem.create({ data: {
          ...archive.data, judgeConfig: archive.data.judgeConfig ?? undefined,
        }, select: { id: true, title: true } });
        const directory = insideRoot(path.join(root, String(problem.id)));
        // Never overwrite an orphan directory belonging to an older installation.
        await fs.mkdir(directory);
        createdDirectories.push(directory);
        await fs.mkdir(path.join(directory, "data"));
        await fs.mkdir(path.join(directory, "assets"));
        for (const [name, content] of archive.files) {
          if (!/^(data|assets)\/[^/\\]+$/.test(name) || /[:\0]/.test(name) || name.endsWith("/.") || name.endsWith("/..")) {
            throw new Error("Invalid Polygon output filename.");
          }
          await fs.writeFile(insideRoot(path.join(directory, name)), content, { flag: "wx" });
        }
        await tx.problem.update({ where: { id: problem.id }, data: {
          sections: archive.data.sections.map((section) => ({ ...section,
            content: section.content.replaceAll(POLYGON_ASSET_PREFIX, `/api/problems/${problem.id}/assets/`),
          })),
        } });
        importedProblems.push({ ...problem, ...(displayId ? { displayId } : {}) });
      }
      return { importedProblems, warnings: problems.flatMap((problem) => problem.warnings) };
    }, { timeout: 120000, maxWait: 10000 });
  } catch (error) {
    const cleanup = await Promise.allSettled(createdDirectories.map((directory) => fs.rm(insideRoot(directory), { recursive: true, force: true })));
    for (const result of cleanup) if (result.status === "rejected") console.error("Polygon import cleanup failed:", result.reason);
    throw error;
  }
}
