/** Native installation, browser pairing, administrator selection and real judging. */
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  const base = (process.env.SUBMIT_TEST_URL || "http://localhost:3001").replace(/\/+$/, "");
  const contestId = 2, username = "team0001";
  const runId = `submit-macos-qa-${randomUUID()}`;
  const reportPath = path.resolve(".local/submit-macos-qa/report.json");
  const checks: string[] = [];
  const report: Record<string, unknown> = { runId, base, contestId, username, startedAt: new Date().toISOString(), passed: false, checks };
  const secrets = new Set<string>(), deviceTokens = new Set<string>();
  let temporaryRoot: string | undefined, adminId: string | undefined;
  let originalContest: number | null | undefined;
  let cookie = "";
  function redact(text: string) {
    for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted token]");
  }
  function pass(name: string) { checks.push(name); console.log(`PASS ${name}`); }
  async function request(route: string, options: { method?: string; body?: unknown; token?: string; admin?: boolean; origin?: string } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json", Origin: options.origin ?? base };
    if (options.admin) headers.Cookie = cookie;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(base + route, { method: options.method || "GET", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    return { response, data };
  }
  async function selectContest(id: number | null) {
    const result = await request("/api/admin/cli-settings", { method: "PUT", body: { activeContestId: id }, admin: true });
    assert.equal(result.response.status, 200, redact(JSON.stringify(result.data)));
  }
  try {
    assert.equal(process.platform, "darwin", "Run this integration test on macOS.");
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    assert(localHosts.has(new URL(base).hostname) && new URL(base).port === "3001", "Only the local service on port 3001 may be tested.");
    assert(localHosts.has(new URL(process.env.DATABASE_URL!).hostname), "Only a local database may be tested.");
    const contest = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
    assert.match(contest.title, /测试|test|qa/i);
    assert.equal(contest.type, "PUBLIC");
    assert.equal(contest.status, "RUNNING");
    assert(contest.startTime <= new Date() && contest.endTime > new Date());
    const account = await prisma.user.findUniqueOrThrow({ where: { contestId_username: { contestId, username } } });
    assert.equal(account.role, "TEAM"); assert.equal(account.proctoringKeyHash, null); assert(account.plainPassword);
    secrets.add(account.plainPassword);
    const problem = await prisma.contestProblem.findFirstOrThrow({ where: { contestId, displayId: "A" }, include: { problem: true } });
    assert.match(problem.problem.title, /^a\s*\+\s*b$/i);
    const adminPassword = randomBytes(24).toString("base64url"); secrets.add(adminPassword);
    const admin = await prisma.globalUser.create({ data: { username: runId, password: await bcrypt.hash(adminPassword, 10), role: "SUPER_ADMIN" } });
    adminId = admin.id;
    const login = await request("/api/auth/login", { method: "POST", body: { username: runId, password: adminPassword, isGlobalAdmin: true } });
    assert.equal(login.response.status, 200);
    cookie = login.response.headers.getSetCookie().find((value) => value.startsWith("auth_token="))?.split(";")[0] || "";
    assert(cookie); secrets.add(cookie);
    assert([401, 403].includes((await request("/api/admin/cli-settings")).response.status));
    assert([401, 403].includes((await request("/api/admin/cli-settings", { method: "PUT", body: { activeContestId: null } })).response.status));
    const settings = await request("/api/admin/cli-settings", { admin: true });
    assert.equal(settings.response.status, 200); originalContest = settings.data.activeContestId ?? null;
    await selectContest(contestId);
    assert.equal((await request("/api/cli/settings")).data.contest.id, contestId);
    pass("Only the administrator selects the active contest; the client follows it");

    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge-submit-qa-"));
    const home = path.join(temporaryRoot, "Home with spaces"), cwd = path.join(temporaryRoot, "Unrelated source directory");
    await Promise.all([home, cwd].map((directory) => fs.mkdir(directory)));
    const env = { HOME: home, ZDOTDIR: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/zsh", NODE_ENV: "test" as const,
      LANG: "en_US.UTF-8", TMPDIR: `${temporaryRoot}/`, NOVAJUDGE_NO_BROWSER: "1" };
    async function command(executable: string, args: string[], onCode?: (code: string) => Promise<void>, answer = "y") {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "", handled = false, confirmations = 0;
        let approval: Promise<void> = Promise.resolve();
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Native CLI timed out.")); }, 60_000);
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          const prompts = stdout.split("Submit this file? [y/N]").length - 1;
          while (confirmations < prompts) {
            child.stdin.write(`${answer}\n`);
            confirmations++;
          }
          const match = stdout.match(/\/cli\/connect\?code=([A-Z0-9-]+)/);
          if (onCode && match && !handled) {
            handled = true; approval = onCode(match[1]);
            approval.catch((error) => { child.kill("SIGKILL"); reject(error); });
          }
        });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", (error) => { clearTimeout(timeout); reject(error); });
        child.on("close", async (code) => {
          clearTimeout(timeout);
          try { await approval; resolve({ code, stdout, stderr }); } catch (error) { reject(error); }
        });
      });
    }
    const installer = path.join(temporaryRoot, "install-macos.sh");
    const download = await fetch(`${base}/api/cli/install`); assert.equal(download.status, 200);
    await fs.writeFile(installer, await download.text());
    const installed = await command("/bin/bash", [installer, "--url", base]); assert.equal(installed.code, 0, installed.stderr);
    const profile = await command("/bin/zsh", ["-lc", "submit --help"]); assert.equal(profile.code, 0, profile.stderr);
    env.PATH = `${home}/.local/bin:${env.PATH}`;
    const submit = (args: string[], onCode?: (code: string) => Promise<void>, answer = "y") => command("/bin/zsh", ["-f", "-c", 'submit "$@"', "qa", ...args], onCode, answer);
    pass("Website installer creates a global command using only macOS system tools");
    const source = `// ${runId}\n#include <iostream>\nint main() { long long a, b; while (std::cin >> a >> b) std::cout << a + b << '\\n'; }\n`;
    await fs.writeFile(path.join(cwd, "A.cpp"), source);
    const result = await submit(["A.cpp"], async (code) => {
      const approval = await request(`/api/cli/device/approval?code=${code}`);
      assert.equal(approval.response.status, 200); assert.equal(approval.data.contest.id, contestId);
      const credentials = { code, username, password: account.plainPassword };
      const wrongOrigin = await request("/api/cli/device/approve", { method: "POST", body: credentials, origin: "https://unrelated.example" });
      assert.equal(wrongOrigin.response.status, 403);
      const wrongPassword = await request("/api/cli/device/approve", { method: "POST", body: { ...credentials, password: randomBytes(20).toString("hex") } });
      assert.equal(wrongPassword.response.status, 401);
      const approved = await request("/api/cli/device/approve", { method: "POST", body: credentials });
      assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
      assert(!JSON.stringify(approved.data).includes("njcli_"));
      const replay = await request("/api/cli/device/approve", { method: "POST", body: credentials }); assert.equal(replay.response.status, 409);
      pass("Browser pairing validates origin, credentials and one-time approval without exposing device secrets");
    });
    assert.equal(result.code, 0, redact(result.stderr || result.stdout));
    const configPath = path.join(home, ".novajudge-submit.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert(config.deviceToken); deviceTokens.add(config.deviceToken); secrets.add(config.deviceToken);
    assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600); assert(!JSON.stringify(config).includes(account.plainPassword));
    const submission = await prisma.submission.findFirstOrThrow({ where: { contestId, userId: account.id, code: source } });
    assert.equal(submission.problemId, problem.problemId); assert.equal(submission.language, "cpp");
    assert.equal(await prisma.submission.count({ where: { code: source } }), 1);
    const statusUrl = `${base}/contest/${contestId}/status/${submission.displayId}`;
    assert(result.stdout.includes(statusUrl));
    assert(!result.stdout.includes(submission.id));
    report.submission = { id: submission.id, displayId: submission.displayId, url: statusUrl, retainedForInspection: true };
    pass("submit A.cpp pairs and submits without terminal account, password or contest input");
    const cancelled = await submit(["A.cpp"], undefined, "n");
    assert.equal(cancelled.code, 0, cancelled.stderr);
    assert(cancelled.stdout.includes("Cancelled. Nothing was submitted."));
    assert.equal(await prisma.submission.count({ where: { code: source } }), 1);
    pass("Declining the confirmation does not create a submission");
    const deadline = Date.now() + 90_000;
    let judged;
    do {
      judged = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id }, select: { verdict: true, passedTests: true, totalTests: true, errorMessage: true } });
      if (!["PENDING", "JUDGING"].includes(judged.verdict)) break;
      await delay(1000);
    } while (Date.now() < deadline);
    report.judgement = judged; assert.equal(judged.verdict, "ACCEPTED", judged.errorMessage || judged.verdict);
    pass("Real judge accepts the submission");
    const status = await submit(["status"]); assert.equal(status.code, 0, status.stderr); assert(status.stdout.includes(username));
    const invalid = await submit(["--problem", "QA_UNKNOWN_PROBLEM", "A.cpp"]); assert.notEqual(invalid.code, 0);
    assert.equal(await prisma.submission.count({ where: { code: source } }), 1);
    pass("Reusable binding, status and unknown-problem rejection work");
    await selectContest(null);
    const disabled = await submit(["A.cpp"]); assert.notEqual(disabled.code, 0);
    assert.equal(await prisma.submission.count({ where: { code: source } }), 1);
    pass("Administrator can disable CLI submissions immediately");
    const another = await prisma.contest.findFirst({ where: { id: { not: contestId } }, select: { id: true } });
    if (another) {
      await selectContest(another.id);
      const changed = await request("/api/cli/device", { token: config.deviceToken }); assert.equal(changed.data.status, "contest_changed");
      const rejected = await request("/api/cli/device/submit", { method: "POST", token: config.deviceToken, body: { problem: "A", language: "cpp", code: source, contestId } });
      assert.equal(rejected.response.status, 409); assert.equal(await prisma.submission.count({ where: { code: source } }), 1);
      pass("Switching contest prevents old team identity from being used in the new contest");
    }
    await selectContest(contestId);
    // Switching away and back must not revive the old authorization.
    assert.equal((await request("/api/cli/device", { token: config.deviceToken })).data.status, "expired");
    const reconnected = await submit(["login"], async (code) => {
      const approved = await request("/api/cli/device/approve", { method: "POST", body: { code, username, password: account.plainPassword } });
      assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
    });
    assert.equal(reconnected.code, 0, reconnected.stderr);
    const freshConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.notEqual(freshConfig.deviceToken, config.deviceToken);
    deviceTokens.add(freshConfig.deviceToken); secrets.add(freshConfig.deviceToken);
    pass("Returning to a previous contest requires fresh browser approval");
    const loggedOut = await submit(["logout"]); assert.equal(loggedOut.code, 0, loggedOut.stderr);
    await assert.rejects(fs.access(configPath), { code: "ENOENT" });
    assert.equal((await request("/api/cli/device", { token: freshConfig.deviceToken })).response.status, 401);
    pass("Logout revokes the server device and removes local credentials");
    report.passed = true;
  } catch (error) {
    report.error = redact(error instanceof Error ? error.message : String(error)); console.error(`FAIL ${report.error}`); process.exitCode = 1;
  } finally {
    for (const token of deviceTokens) await prisma.cliDevice.deleteMany({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    if (originalContest !== undefined) {
      const selected = report.passed && process.env.SUBMIT_TEST_KEEP_ACTIVE === "1" ? contestId : originalContest;
      await selectContest(selected); report.activeContestAfterTest = selected;
    }
    if (adminId) await prisma.globalUser.delete({ where: { id: adminId } });
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
    await prisma.$disconnect(); report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2)) + "\n", { mode: 0o600 });
    console.log(`Report: ${reportPath}`);
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
