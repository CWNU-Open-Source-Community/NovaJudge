/** Real Windows CLI + monitoring HTTP grants + database + judge, with isolated fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import bcrypt from "bcryptjs";

async function main() {
  assert.equal(process.platform, "win32", "Run on Windows with Windows PowerShell 5.1.");
  const base = (process.env.SUBMIT_TEST_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  assert(local.has(new URL(base).hostname), "Only a local web service may be tested.");
  const database = new URL(process.env.DATABASE_URL!);
  assert(local.has(database.hostname) && /qa|test/.test(database.pathname), "Use a dedicated local QA/test database.");
  // Reject unsafe targets before importing modules that open database/Redis connections.
  const { prisma } = await import("../lib/prisma");
  const { redis } = await import("../lib/redis");
  const { judgeQueue } = await import("../lib/queue");
  const runId = `submit-windows-${randomUUID()}`;
  const reportPath = path.resolve(".local/submit-windows-qa/report.json");
  const checks: string[] = [];
  const report: Record<string, unknown> = { runId, base, startedAt: new Date().toISOString(), passed: false, checks };
  const password = randomBytes(24).toString("base64url"), apiKey = randomBytes(32).toString("hex");
  const secrets = new Set([password, apiKey]);
  let root = "", adminId = "", contestId = 0, problemId = 0, cookie = "";
  let ownedProblemDirectory = "";
  let originalContest: number | null | undefined;
  type DesktopLogin = { scope: { origin: string; contestId: string }; backendOrigin: string; cookieToken: string; proctoringKey: string; contestAccessToken?: string };
  let desktop: { status: { phase: string; message: string }; connect(login: DesktopLogin): Promise<void>; reset(): Promise<void>; refreshEligibility(): void; shutdown(): Promise<void> } | undefined;
  let desktopContext: { platform: string; releaseChannel: string; selectedBackendOrigin: string; backendOrigin: string; scope: DesktopLogin["scope"]; proctoringKey: string } | undefined;
  async function bindDesktop(proof: { token: string; proctoringKey: string; contestAccessToken?: string }) {
    assert(desktop && desktopContext);
    desktopContext.proctoringKey = proof.proctoringKey;
    await desktop.connect({ scope: desktopContext.scope, backendOrigin: desktopContext.backendOrigin,
      cookieToken: proof.token, proctoringKey: proof.proctoringKey, contestAccessToken: proof.contestAccessToken });
    assert.equal(desktop.status.phase, "ready", desktop.status.message);
  }
  const redact = (value: string) => [...secrets].reduce((text, secret) => text.split(secret).join("[redacted]"), value);
  const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
  async function request(route: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", Origin: base, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000), redirect: "manual" });
    const data = await response.json();
    for (const key of ["token", "deviceToken", "proctoringKey", "contestAccessToken"]) if (data[key]) secrets.add(data[key]);
    return { status: response.status, data, response };
  }
  async function selectContest(id: number | null) {
    const result = await request("/api/admin/cli-settings", "PUT", { activeContestId: id }, { Cookie: cookie });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  function command(script: string, args: string[], input = "", onCode?: (code: string) => Promise<void>) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const executable = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
      const child = spawn(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
        cwd: root, windowsHide: true, env: { ...process.env, USERPROFILE: path.join(root, "用户 Home"), LOCALAPPDATA: path.join(root, "Local AppData"),
          NOVAJUDGE_URL: base, NOVAJUDGE_NO_BROWSER: "1", PATH: path.dirname(executable) },
      });
      let stdout = "", stderr = "", handled = false;
      let approval = Promise.resolve();
      const timer = setTimeout(() => { child.kill(); reject(new Error("Windows command timed out")); }, 90000);
      child.stdout.on("data", chunk => {
        stdout += chunk;
        const code = stdout.match(/\/cli\/connect\?code=([A-Z0-9-]+)/)?.[1];
        if (code && onCode && !handled) {
          handled = true; approval = onCode(code);
          approval.catch(error => { child.kill(); reject(error); });
        }
      });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", async code => {
        clearTimeout(timer);
        try { await approval; resolve({ code, stdout, stderr }); } catch (error) { reject(error); }
      });
      child.stdin.end(input);
    });
  }
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge Windows 联调 "));
    await fs.mkdir(path.join(root, "用户 Home"));
    await fs.mkdir(path.join(root, "Local AppData"));
    const admin = await prisma.globalUser.create({ data: { username: runId, password: await bcrypt.hash(password, 10), role: "SUPER_ADMIN", apiKeys: { create: { key: apiKey } } } });
    adminId = admin.id;
    const login = await request("/api/auth/login", "POST", { username: runId, password, isGlobalAdmin: true });
    assert.equal(login.status, 200);
    cookie = login.response.headers.getSetCookie().find(value => value.startsWith("auth_token="))!.split(";")[0]; secrets.add(cookie);
    const settings = await request("/api/admin/cli-settings", "GET", undefined, { Cookie: cookie });
    assert.equal(settings.status, 200); originalContest = settings.data.activeContestId;
    const contest = await prisma.contest.create({ data: { title: runId, status: "RUNNING", visible: false, startTime: new Date(Date.now() - 60000), endTime: new Date(Date.now() + 3600000) } });
    contestId = contest.id;
    const user = await prisma.user.create({ data: { username: "team-windows", displayName: "Windows 中文队伍", contestId, password: await bcrypt.hash(password, 10) } });
    // An isolated database still shares the workspace's uploads directory. Use a
    // random ID and claim an absent directory before writing any fixture files.
    const problem = await prisma.problem.create({ data: { id: 1_000_000_000 + randomBytes(4).readUInt32BE() % 1_000_000_000,
      title: runId + " A+B", defaultTimeLimit: 1000, defaultMemoryLimit: 256, sections: [], samples: [], judgeConfig: { type: "default", cases: [{ input: "1.in", output: "1.out" }] } } });
    problemId = problem.id;
    await prisma.contestProblem.create({ data: { contestId, problemId, displayId: "A" } });
    const dataDir = path.resolve("uploads/problems", String(problemId), "data");
    await fs.mkdir(path.resolve("uploads/problems"), { recursive: true });
    await fs.mkdir(path.dirname(dataDir));
    ownedProblemDirectory = path.dirname(dataDir);
    await fs.mkdir(dataDir);
    await fs.writeFile(path.join(dataDir, "1.in"), "2 3\n"); await fs.writeFile(path.join(dataDir, "1.out"), "5\n");
    await fs.writeFile(path.join(dataDir, "problem.yml"), "type: default\ncases:\n  - input: 1.in\n    output: 1.out\n");
    await selectContest(contestId);
    const installerResponse = await fetch(base + "/api/cli/install?platform=windows"); assert.equal(installerResponse.status, 200);
    const installer = path.join(root, "install-windows.ps1"); await fs.writeFile(installer, await installerResponse.text());
    const installed = await command(installer, ["-Url", base, "-NoPathUpdate"]); assert.equal(installed.code, 0, installed.stderr);
    const script = path.join(root, "Local AppData/NovaJudge/submit/novajudge-submit.ps1");
    const configPath = path.join(root, "用户 Home/.novajudge-submit.json");
    const source = '#include <iostream>\n// 中文联调\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n';
    await fs.writeFile(path.join(root, "A.cpp"), source);
    pass("Website distributes and installs the native Windows client in a Chinese/space path");
    const paired = await command(script, ["login"], "", async code => {
      const approved = await request("/api/cli/device/approve", "POST", { code, username: user.username, password });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
    });
    assert.equal(paired.code, 0, paired.stderr);
    const normal = JSON.parse(await fs.readFile(configPath, "utf8")); secrets.add(normal.deviceToken);
    pass("Ordinary browser pairing works against the real API");
    const monitoredLogin = () => request("/api/cli/login", "POST", { username: user.username, password, contestId, loginSource: "PROCTORING", contestPassword: password }, { "x-api-key": apiKey });
    const monitor = await monitoredLogin(); assert.equal(monitor.status, 200, JSON.stringify(monitor.data));
    const headers = { Authorization: `Bearer ${monitor.data.token}`, "x-novajudge-proctor-key": monitor.data.proctoringKey };
    assert.equal((await request("/api/cli/device/proctoring", "POST", {}, { Authorization: headers.Authorization })).status, 403);
    assert.equal((await request("/api/cli/login", "POST", { username: user.username, password, contestId })).status, 403);
    assert.equal((await request("/api/cli/device", "GET", undefined, { Authorization: `Bearer ${normal.deviceToken}` })).data.status, "disabled");
    const grant = await request("/api/cli/device/proctoring", "POST", {}, headers); assert.equal(grant.status, 200, JSON.stringify(grant.data));
    assert.equal(grant.data.loginSource, "PROCTORING");
    if (process.env.PROCTORING_DESKTOP_ROOT) {
      const desktopRoot = path.resolve(process.env.PROCTORING_DESKTOP_ROOT);
      const { NovaJudgeSubmit } = await import(pathToFileURL(path.join(desktopRoot, "apps/desktop/src/main/novajudge-submit.ts")).href);
      desktopContext = { platform: "win32", releaseChannel: "intranet", selectedBackendOrigin: base, backendOrigin: base,
        scope: { origin: base, contestId: String(contestId) }, proctoringKey: monitor.data.proctoringKey };
      desktop = new NovaJudgeSubmit({ home: path.join(root, "用户 Home"), bundleDirectory: path.join(desktopRoot, "apps/desktop/resources/novajudge-submit"),
        windowsInstallation: { localAppData: path.join(root, "Local AppData"), updatePath: false }, context: () => desktopContext,
        changed: () => {} });
      await bindDesktop(monitor.data);
      const managed = JSON.parse(await fs.readFile(configPath, "utf8")); secrets.add(managed.deviceToken);
      assert.equal(managed.managedBy, "novajudge-proctor-desktop");
      assert.equal(managed.loginSource, "PROCTORING");
      assert(!managed.token && !managed.proctoringKey && !managed.contestAccessToken);
      report.desktopSource = desktopRoot;
      pass("Actual desktop manager installs its offline Windows bundle and writes an owned monitored grant");
    } else {
      await fs.writeFile(configPath, JSON.stringify({ baseUrl: base, ...grant.data }));
      report.desktopLifecycle = "Not tested; set PROCTORING_DESKTOP_ROOT to the desktop source directory.";
    }
    pass("Real monitoring login issues a dedicated grant and rejects missing proof and ordinary login");
    const cancelled = await command(script, ["A.cpp"], "n\n"); assert.equal(cancelled.code, 0, cancelled.stderr);
    assert.equal(await prisma.submission.count({ where: { contestId } }), 0);
    const submitted = await command(script, ["A.cpp"], "y\n"); assert.equal(submitted.code, 0, submitted.stderr);
    assert.doesNotMatch(submitted.stdout, /Pairing code/);
    assert.match(submitted.stdout, /Submitted #1 A cpp/);
    const submission = await prisma.submission.findFirstOrThrow({ where: { contestId } });
    assert.equal(submission.userId, user.id); assert.equal(submission.code, source);
    const deadline = Date.now() + 90000;
    let verdict = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    while (["PENDING", "JUDGING"].includes(verdict.verdict) && Date.now() < deadline) {
      await delay(500); verdict = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    }
    assert.equal(verdict.verdict, "ACCEPTED", verdict.errorMessage || verdict.verdict);
    report.submission = { id: verdict.id, displayId: verdict.displayId, verdict: verdict.verdict };
    pass("Monitored Windows submission requires y, preserves UTF-8 source, and is judged ACCEPTED");
    await monitoredLogin();
    const expired = await command(script, ["A.cpp"], "y\n"); assert.equal(expired.code, 1); assert.match(expired.stderr, /monitoring client/);
    assert.doesNotMatch(expired.stdout, /Pairing code/); assert.equal(await prisma.submission.count({ where: { contestId } }), 1);
    pass("Monitoring relogin revokes the old CLI binding without browser fallback or extra submission");
    await prisma.contest.update({ where: { id: contestId }, data: { type: "PRIVATE", password } });
    const privateLogin = await monitoredLogin(); assert.equal(privateLogin.status, 200);
    const privateHeaders = { Authorization: `Bearer ${privateLogin.data.token}`, "x-novajudge-proctor-key": privateLogin.data.proctoringKey };
    assert.equal((await request("/api/cli/device/proctoring", "POST", {}, privateHeaders)).status, 403);
    const privateGrant = await request("/api/cli/device/proctoring", "POST", {}, { ...privateHeaders, "x-contest-access-token": privateLogin.data.contestAccessToken });
    assert.equal(privateGrant.status, 200);
    if (desktop) await bindDesktop(privateLogin.data);
    else await fs.writeFile(configPath, JSON.stringify({ baseUrl: base, ...privateGrant.data }));
    const logoutToken = JSON.parse(await fs.readFile(configPath, "utf8")).deviceToken; secrets.add(logoutToken);
    await prisma.contest.update({ where: { id: contestId }, data: { password: password + "-rotated" } });
    const revoked = await command(script, ["A.cpp"], "y\n"); assert.equal(revoked.code, 1); assert.match(revoked.stderr, /monitoring client/);
    pass("Private contest grant is required and password rotation revokes monitored submit");
    await selectContest(null);
    assert.equal((await command(script, ["A.cpp"], "y\n")).code, 1);
    pass("Administrator disabling CLI immediately prevents monitored submissions");
    const logout = await command(script, ["logout"]); assert.equal(logout.code, 0, logout.stderr);
    await assert.rejects(fs.access(configPath));
    assert.equal((await request("/api/cli/device", "GET", undefined, { Authorization: `Bearer ${logoutToken}` })).status, 401);
    pass("Logout revokes the server grant and deletes local credentials");
    if (desktop && desktopContext) {
      await prisma.contest.update({ where: { id: contestId }, data: { type: "PUBLIC" } }); await selectContest(contestId);
      const currentLogin = await monitoredLogin(); assert.equal(currentLogin.status, 200);
      await bindDesktop(currentLogin.data);
      const resetToken = JSON.parse(await fs.readFile(configPath, "utf8")).deviceToken; secrets.add(resetToken);
      await desktop.reset(); await assert.rejects(fs.access(configPath));
      assert.equal((await request("/api/cli/device", "GET", undefined, { Authorization: `Bearer ${resetToken}` })).status, 401);
      pass("Actual desktop logout/exam-end reset revokes its grant and removes its own config");
      await bindDesktop(currentLogin.data);
      const publicToken = JSON.parse(await fs.readFile(configPath, "utf8")).deviceToken; secrets.add(publicToken);
      desktopContext.releaseChannel = "public"; desktop.refreshEligibility(); await desktop.shutdown();
      await assert.rejects(fs.access(configPath));
      assert.equal((await request("/api/cli/device", "GET", undefined, { Authorization: `Bearer ${publicToken}` })).status, 401);
      await desktop.connect({ scope: desktopContext.scope, backendOrigin: base, cookieToken: currentLogin.data.token, proctoringKey: currentLogin.data.proctoringKey });
      assert.equal(desktop.status.phase, "idle"); await assert.rejects(fs.access(configPath));
      pass("Actual desktop intranet-to-public switch revokes submit and public mode never enables it");
    }
    report.passed = true;
  } catch (error) {
    report.error = redact(error instanceof Error ? error.message : String(error)); console.error(report.error); process.exitCode = 1;
  } finally {
    if (desktop) await desktop.shutdown();
    if (originalContest !== undefined) await selectContest(originalContest);
    if (contestId) {
      for (const submission of await prisma.submission.findMany({ where: { contestId } })) {
        const job = await judgeQueue.getJob(`judge-sub-${submission.id}`); if (job) await job.remove();
      }
      await prisma.balloon.deleteMany({ where: { contestId } });
      await prisma.submission.deleteMany({ where: { contestId } });
      await prisma.contestProblem.deleteMany({ where: { contestId } });
      await prisma.user.deleteMany({ where: { contestId } });
      await prisma.contest.delete({ where: { id: contestId } });
      await redis.del(`contest:${contestId}:display_id`);
    }
    if (problemId) {
      await prisma.problem.delete({ where: { id: problemId } });
      if (ownedProblemDirectory) await fs.rm(ownedProblemDirectory, { recursive: true, force: true });
    }
    if (adminId) await prisma.globalUser.delete({ where: { id: adminId } });
    if (root) await fs.rm(root, { recursive: true, force: true });
    await judgeQueue.close(); await redis.quit(); await prisma.$disconnect();
    report.finishedAt = new Date().toISOString(); await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2)) + "\n"); console.log(`Report: ${reportPath}`);
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
