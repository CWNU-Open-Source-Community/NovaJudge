/** Real HTTP uploads against a local deployment; creates and removes only its own fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { prisma } from "../lib/prisma";

async function main() {
  const base = (process.env.PROBLEM_UPDATE_TEST_URL || process.env.NOVAJUDGE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  assert(localHosts.has(new URL(base).hostname), "Only a local web service may be tested.");
  assert(localHosts.has(new URL(process.env.DATABASE_URL!).hostname), "Only a local database may be tested.");

  const runId = `problem-update-qa-${randomUUID()}`;
  const artifacts = path.resolve(".local", "problem-update-qa", runId);
  const uploadsRoot = path.resolve("uploads", "problems");
  await fs.mkdir(artifacts, { recursive: true });
  const report: Record<string, unknown> = { runId, base, startedAt: new Date().toISOString(), passed: false };
  const problemIds: number[] = [];
  const contestIds: number[] = [];
  const uploadDirs: string[] = [];
  let adminId: string | undefined;
  let submissionId: string | undefined;
  let cookie = "";

  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    return fetch(base + url, { ...init, headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
  }
  async function exportProblems(ids: number[], name: string) {
    const response = await request("/api/problems/export", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problemIds: ids }),
    });
    assert.equal(response.status, 200, `Export ${name} must succeed`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(artifacts, name), bytes);
    return bytes;
  }
  async function upload(problemId: number, bytes: Buffer, name: string) {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), name);
    const response = await request(`/api/problems/${problemId}/update`, { method: "POST", body });
    return { status: response.status, body: await response.json() };
  }
  async function filesSnapshot(problemId: number) {
    const result: Record<string, string> = {};
    for (const directory of ["data", "assets"]) {
      const dir = path.join(uploadsRoot, String(problemId), directory);
      for (const name of (await fs.readdir(dir)).sort()) {
        result[`${directory}/${name}`] = createHash("sha256").update(await fs.readFile(path.join(dir, name))).digest("hex");
      }
    }
    return result;
  }
  async function snapshot(problemId: number) {
    return {
      problem: await prisma.problem.findUniqueOrThrow({ where: { id: problemId } }),
      links: await prisma.contestProblem.findMany({ where: { problemId }, orderBy: { contestId: "asc" } }),
      submissions: await prisma.submission.findMany({ where: { problemId }, orderBy: { id: "asc" } }),
      files: await filesSnapshot(problemId),
    };
  }
  async function createProblem(suffix: string, caseName: string, time: number) {
    const problem = await prisma.problem.create({ data: {
      title: `${runId}-${suffix}`, type: "default", defaultTimeLimit: time, defaultMemoryLimit: time === 1000 ? 128 : 256,
      sections: [{ title: "Description", content: suffix }], samples: [{ input: `${suffix}\n`, output: `${suffix} answer\n` }],
      hint: `${suffix} hint`, judgeConfig: { type: "default", cases: [{ input: `${caseName}.in`, output: `${caseName}.out` }] },
    } });
    problemIds.push(problem.id);
    const dir = path.join(uploadsRoot, String(problem.id));
    await fs.mkdir(uploadsRoot, { recursive: true });
    await fs.mkdir(dir); // Refuse to overwrite an orphan directory from any earlier problem.
    uploadDirs.push(dir);
    await fs.mkdir(path.join(dir, "data"));
    await fs.mkdir(path.join(dir, "assets"));
    await fs.writeFile(path.join(dir, "data", `${caseName}.in`), `${suffix}\n`);
    await fs.writeFile(path.join(dir, "data", `${caseName}.out`), `${suffix} answer\n`);
    await fs.writeFile(path.join(dir, "data", "problem.yml"), `type: default\ncases:\n  - input: ${caseName}.in\n    output: ${caseName}.out\n`);
    await fs.writeFile(path.join(dir, "assets", `${caseName}.svg`), `<svg xmlns="http://www.w3.org/2000/svg"><text>${suffix}</text></svg>`);
    await fs.writeFile(path.join(dir, "assets", "shared.txt"), `${suffix} attachment`);
    return prisma.problem.update({ where: { id: problem.id }, data: {
      sections: [{ title: "Description", content: `${suffix}: ![](/api/problems/${problem.id}/assets/${caseName}.svg)` }],
      hint: `${suffix}: /api/problems/${problem.id}/assets/shared.txt`,
    } });
  }

  try {
    const password = randomBytes(24).toString("base64url");
    const admin = await prisma.globalUser.create({ data: { username: runId, password: await bcrypt.hash(password, 10), role: "SUPER_ADMIN" } });
    adminId = admin.id;
    const login = await request("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: runId, password, isGlobalAdmin: true }),
    });
    assert.equal(login.status, 200, "Temporary administrator must log in through the real endpoint");
    cookie = login.headers.getSetCookie().find((value) => value.startsWith("auth_token="))?.split(";")[0] || "";
    assert(cookie, "Login must set the administrator session cookie");

    const target = await createProblem("original", "old", 1000);
    const source = await createProblem("replacement", "new", 2000);
    for (const [index, displayId] of ["A", "C"].entries()) {
      const contest = await prisma.contest.create({ data: {
        title: `${runId}-contest-${index + 1}`, type: "PRIVATE", password: randomBytes(18).toString("base64url"),
        visible: false, status: "ENDED", startTime: new Date(Date.now() - 7200_000), endTime: new Date(Date.now() - 3600_000),
      } });
      contestIds.push(contest.id);
      await prisma.contestProblem.create({ data: {
        contestId: contest.id, problemId: target.id, displayId,
        realTimeLimit: 3000 + index, realMemoryLimit: 512 + index, color: index === 0 ? "#ff0000" : "#00ff00",
      } });
    }
    const code = "int main() { return 0; }";
    const submission = await prisma.submission.create({ data: {
      problemId: target.id, contestId: contestIds[0], globalUserId: admin.id, language: "cpp", code, codeLength: code.length,
      verdict: "ACCEPTED", displayId: 1, timeUsed: 10, memoryUsed: 1024, passedTests: 1, totalTests: 1,
    } });
    submissionId = submission.id;
    const before = await snapshot(target.id);
    const sourceBefore = await snapshot(source.id);
    const countBefore = await prisma.problem.count();
    report.targetId = target.id;
    report.sourceId = source.id;
    report.contestIds = contestIds;
    report.before = before;

    const singleBytes = await exportProblems([source.id], "single-problem.zip");
    const single = await upload(target.id, singleBytes, "single-problem.zip");
    report.singleUpload = single;
    assert.equal(single.status, 200, JSON.stringify(single));
    assert.equal(single.body.success, true);
    assert.equal(single.body.problem.id, target.id);
    const afterSingle = await snapshot(target.id);
    report.afterSingle = afterSingle;
    assert.equal(afterSingle.problem.id, before.problem.id);
    assert.equal(afterSingle.problem.title, source.title);
    assert.equal(afterSingle.problem.defaultTimeLimit, source.defaultTimeLimit);
    assert.equal(afterSingle.problem.defaultMemoryLimit, source.defaultMemoryLimit);
    assert.deepEqual(afterSingle.problem.samples, source.samples);
    assert.deepEqual(afterSingle.problem.judgeConfig, source.judgeConfig);
    assert.equal(afterSingle.problem.createdAt.getTime(), before.problem.createdAt.getTime());
    assert(afterSingle.problem.updatedAt > before.problem.updatedAt);
    assert.deepEqual(afterSingle.links, before.links, "Both contest links and their override settings must be unchanged");
    assert.deepEqual(afterSingle.submissions, before.submissions, "Existing submission identity and verdict must be unchanged");
    assert.deepEqual(afterSingle.files, sourceBefore.files, "Replacement must match every exported file and remove old files");
    assert.equal(await prisma.problem.count(), countBefore, "Updating must not add a problem");
    assert.deepEqual(afterSingle.problem.sections, [{ title: "Description", content: `replacement: ![](/api/problems/${target.id}/assets/new.svg)` }]);
    assert.equal(afterSingle.problem.hint, `replacement: /api/problems/${target.id}/assets/shared.txt`);
    const newAsset = await request(`/api/problems/${target.id}/assets/new.svg`);
    assert.equal(newAsset.status, 200);
    assert.match(await newAsset.text(), /replacement/);
    assert.equal((await request(`/api/problems/${target.id}/assets/old.svg`)).status, 404);
    assert.equal((await request(`/contest/${contestIds[0]}/problems/A`)).status, 200, "The existing contest problem URL must still resolve");

    // Export a real two-problem package and make its first title unmistakably different.
    const multiZip = await JSZip.loadAsync(await exportProblems([source.id, target.id], "multi-problem.zip"));
    const metadata = Object.values(multiZip.files).filter((entry) => !entry.dir && entry.name.endsWith("/problem.json"));
    assert.equal(metadata.length, 2);
    const first = JSON.parse(await metadata[0].async("text"));
    multiZip.file(metadata[0].name, JSON.stringify({ ...first, title: `${runId}-MUST-NOT-APPLY` }));
    const multiBytes = await multiZip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(path.join(artifacts, "multi-problem.zip"), multiBytes);
    const multi = await upload(target.id, multiBytes, "multi-problem.zip");
    report.multiUpload = multi;
    assert.equal(multi.status, 400, JSON.stringify(multi));
    assert.match(multi.body.error, /exactly one.*found 2/);
    const afterMulti = await snapshot(target.id);
    report.afterMulti = afterMulti;
    assert.deepEqual(afterMulti, afterSingle, "Rejected multi-problem ZIP must not change metadata, timestamps, files, links or submissions");
    assert.equal(await prisma.problem.count(), countBefore);
    assert.deepEqual(await snapshot(source.id), sourceBefore, "The exported source problem must remain untouched");
    report.checks = {
      singleUploadSucceeded: true, multiUploadRejected: true, targetIdUnchanged: true,
      bothContestLinksUnchanged: true, contestOverridesUnchanged: true, submissionUnchanged: true,
      noProblemCreated: true, filesReplaced: true, oldFilesRemoved: true, assetUrlsRemapped: true,
      rejectedUploadLeftAllStateUnchanged: true, sourceProblemUnchanged: true,
    };
    report.passed = true;
    console.log(JSON.stringify({ singleStatus: single.status, multiStatus: multi.status, targetId: target.id, contestIds, checks: report.checks }));
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const cleanupErrors: string[] = [];
    const cleanup = async (action: () => Promise<unknown>) => {
      try { await action(); } catch (error) { cleanupErrors.push(String(error)); }
    };
    if (submissionId) await cleanup(() => prisma.submission.delete({ where: { id: submissionId } }));
    if (contestIds.length) {
      await cleanup(() => prisma.contestProblem.deleteMany({ where: { contestId: { in: contestIds }, problemId: { in: problemIds } } }));
      await cleanup(() => prisma.contest.deleteMany({ where: { id: { in: contestIds } } }));
    }
    if (problemIds.length) await cleanup(() => prisma.problem.deleteMany({ where: { id: { in: problemIds } } }));
    if (adminId) await cleanup(() => prisma.globalUser.delete({ where: { id: adminId } }));
    for (const dir of uploadDirs) {
      await cleanup(async () => {
        const resolved = path.resolve(dir);
        assert.equal(path.dirname(resolved), uploadsRoot);
        assert(problemIds.includes(Number(path.basename(resolved))));
        await fs.rm(resolved, { recursive: true, force: true });
      });
    }
    report.cleanup = { complete: cleanupErrors.length === 0, errors: cleanupErrors };
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Report and uploaded ZIPs: ${artifacts}`);
    await prisma.$disconnect();
    assert.equal(cleanupErrors.length, 0, "Fixture cleanup must succeed; see the saved report");
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
