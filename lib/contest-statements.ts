import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Contest PDFs live beside the editorial, outside public/. A problem keeps its
// statement when its display letter changes, even when reused in another contest.
function statementDirectory(contestId: number) {
  if (!Number.isSafeInteger(contestId) || contestId < 1) throw new Error("Invalid contest ID");
  return path.join(process.cwd(), "uploads", "contests", String(contestId), "statements");
}

export function statementFilename(contestProblemId: string | null) {
  return contestProblemId === null ? "problemset.pdf" : `problem-${Buffer.from(contestProblemId).toString("base64url")}.pdf`;
}

export async function listContestStatements(contestId: number) {
  try {
    return new Set(await fs.readdir(/* turbopackIgnore: true */ statementDirectory(contestId)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }
}

export async function openContestStatement(contestId: number, contestProblemId: string | null) {
  try {
    return await fs.open(/* turbopackIgnore: true */ path.join(statementDirectory(contestId), statementFilename(contestProblemId)), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Publish a complete file in one rename so a concurrent download sees one version.
export async function writeContestStatement(contestId: number, contestProblemId: string | null, pdf: Buffer) {
  const dir = statementDirectory(contestId);
  const temporary = path.join(dir, randomUUID() + ".tmp");
  await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  try {
    await fs.writeFile(/* turbopackIgnore: true */ temporary, pdf, { flag: "wx" });
    await fs.rename(/* turbopackIgnore: true */ temporary, path.join(dir, statementFilename(contestProblemId)));
  } finally {
    await fs.rm(/* turbopackIgnore: true */ temporary, { force: true });
  }
}

export async function removeContestStatement(contestId: number, contestProblemId: string | null) {
  await fs.rm(/* turbopackIgnore: true */ path.join(statementDirectory(contestId), statementFilename(contestProblemId)), { force: true });
}

export async function removeContestStatements(contestId: number) {
  await fs.rm(/* turbopackIgnore: true */ statementDirectory(contestId), { recursive: true, force: true });
}
