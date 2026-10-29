import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const source = fileURLToPath(new URL("./submit.ps1", import.meta.url));
const windows = process.platform === "win32";
const powershell = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const contest = { id: 17, title: "Current Contest" };
const user = { username: "team001", displayName: "Test Team" };
const ready = { status: "ready", loginSource: "BROWSER", contest, user, expiresAt: new Date(Date.now() + 86400000).toISOString() };
const proctoringReady = { ...ready, loginSource: "PROCTORING" };
const execFileAsync = promisify(execFile);

async function assertPrivateConfig(configPath) {
  // POSIX mode bits do not describe Windows ACLs. Inspect the actual DACL through
  // Windows PowerShell 5.1 / .NET, without depending on Security module discovery.
  const { stdout } = await execFileAsync(powershell, ["-NoProfile", "-Command", `
    $ErrorActionPreference = 'Stop'
    $Acl = [IO.File]::GetAccessControl($env:NOVAJUDGE_TEST_CONFIG_PATH)
    [ordered]@{
      version = $PSVersionTable.PSVersion.ToString()
      protected = $Acl.AreAccessRulesProtected
      currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      owner = $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      rules = @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
        [ordered]@{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); inherited = $_.IsInherited }
      })
    } | ConvertTo-Json -Depth 4 -Compress
  `], { windowsHide: true, timeout: 10000, env: { ...process.env, NOVAJUDGE_TEST_CONFIG_PATH: configPath } });
  const acl = JSON.parse(stdout);
  assert.match(acl.version, /^5\.1\./);
  assert.equal(acl.protected, true, "device credentials must not inherit parent ACLs");
  assert.equal(acl.owner, acl.currentSid);
  assert.deepEqual(acl.rules, [{ sid: acl.currentSid, type: "Allow", inherited: false }],
    "only the current Windows identity may have access to saved device credentials");
}

function send(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
function pairing(index = 1, extra = {}) {
  return { deviceToken: `njcli_test_device_${index}`, userCode: "ABCD-1234",
    verificationPath: "/cli/connect?code=ABCD-1234", expiresAt: new Date(Date.now() + 600000).toISOString(),
    pollInterval: 2, contest, ...extra };
}
async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge native cli "));
  const home = path.join(directory, "home");
  const installed = path.join(directory, "installed");
  await fs.mkdir(home);
  await fs.mkdir(installed);
  const script = path.join(installed, "submit.ps1");
  await fs.copyFile(source, script);
  await fs.chmod(script, 0o755);
  const requests = [];
  let pairings = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const payload = body ? JSON.parse(body) : undefined;
    requests.push({ method: request.method, path: request.url, headers: request.headers, payload });
    if (handler && handler(request, response, payload, requests) !== false) return;
    if (request.url === "/api/cli/device") {
      if (request.method === "POST") send(response, pairing(++pairings));
      else if (request.method === "GET") send(response, ready);
      else send(response, { success: true });
    } else if (request.url === "/api/cli/device/submit") {
      send(response, { submission: { id: "submission-123", displayId: 9 }, statusUrl: "/contest/17/status/9" });
    } else if (request.url === "/api/cli/device/print") {
      send(response, request.method === "GET" ? proctoringReady : {
        success: true, printJob: { id: "print-job-123", sourceFilename: payload.sourceFilename, status: "PENDING" }, contest,
      });
    } else send(response, { error: "Unexpected endpoint" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const defaults = path.join(installed, "submit-defaults.json");
  await fs.writeFile(defaults, JSON.stringify({ baseUrl: url }));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  function run(args, { env = {}, command = script, input = "", onPrompt } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args], { cwd: directory, windowsHide: true, env: { ...process.env, USERPROFILE: home, PATH: path.dirname(powershell), NOVAJUDGE_URL: "", NOVAJUDGE_NO_BROWSER: "1", ...env } });
      let stdout = "", stderr = "", prompted = false;
      const stop = () => { try { child.kill(); } catch { /* Already exited. */ } };
      const timeout = setTimeout(() => { stop(); reject(new Error(`Native CLI timed out: ${stdout}${stderr}`)); }, 30000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString().replaceAll("\r\n", "\n");
        if (onPrompt && !prompted && /(?:Submit|Print) this file\? \[y\/N\]/.test(stdout)) {
          prompted = true;
          try { Promise.resolve(onPrompt(child, stdout)).catch((error) => { stop(); reject(error); }); }
          catch (error) { stop(); reject(error); }
        }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
      if (!onPrompt) child.stdin.end(input);
    });
  }
  const config = path.join(home, ".novajudge-submit.json");
  async function bind(extra = {}) {
    await fs.writeFile(config, JSON.stringify({ baseUrl: url, ...pairing(), ...ready, ...extra }));
  }
  async function bindProctoring(extra = {}) {
    await fs.writeFile(config, JSON.stringify({ baseUrl: url, deviceToken: "njcli_monitor_device",
      loginSource: "PROCTORING", contest, user, expiresAt: ready.expiresAt, ...extra }));
  }
  return { directory, home, script, defaults, url, requests, run, config, bind, bindProctoring };
}
function success(result) { assert.equal(result.code, 0, result.stderr); }

test("missing server URL fails before pairing; local commands remain usable", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.defaults);
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const args of [["login"], ["A.cpp"]]) {
    const result = await f.run(args);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /No server URL configured/);
    assert.match(result.stderr, /intranet contest site's \/cli page/);
    assert.match(result.stderr, /submit login --url/);
    assert.doesNotMatch(result.stdout, /Pairing code/);
  }
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(f.config));
  success(await f.run(["--help"]));
  const status = await f.run(["status"]);
  success(status);
  assert.match(status.stdout, /Not connected/);
  success(await f.run(["logout"]));
  assert.deepEqual(f.requests, []);
  success(await f.run(["login", "--url", f.url]));
  assert.equal(JSON.parse(await fs.readFile(f.config, "utf8")).baseUrl, f.url);
  assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [
    ["POST", "/api/cli/device"], ["GET", "/api/cli/device"]
  ]);
});

// Only the test runner uses Node. Every client subprocess has a system-only PATH.
test("first submit pairs in browser; later submits reuse authorization and server-selected contest", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.config, "{}", { mode: 0o644 });
  const code = '#include <iostream>\n// 中文 " \\ \nint main(){std::cout << "ok\\n";}\n';
  await fs.writeFile(path.join(f.directory, "A.cpp"), code);
  const first = await f.run(["A.cpp"], { onPrompt(child, output) {
    assert.equal(f.requests.filter((r) => r.path.endsWith("/submit")).length, 0);
    assert.match(output, /File: A.cpp\nProblem: A\nLanguage: cpp/);
    child.stdin.end("y\n");
  } });
  success(first);
  assert.match(first.stdout, /Pairing code: ABCD-1234/);
  assert.match(first.stdout, /Contest: #17 Current Contest/);
  assert.match(first.stdout, /Team: Test Team \(team001\)/);
  assert.match(first.stdout, /Submitted #9 A cpp/);
  assert.match(first.stdout, /\/contest\/17\/status\/9/);
  assert.doesNotMatch(first.stdout, /submission-123/);
  assert.ok(!first.stdout.includes("njcli_"));
  assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [
    ["POST", "/api/cli/device"], ["GET", "/api/cli/device"], ["POST", "/api/cli/device/submit"]
  ]);
  assert.deepEqual(f.requests[0].payload, {});
  assert.deepEqual(f.requests[2].payload, { problem: "A", language: "cpp", code });
  assert.equal(f.requests[2].headers.authorization, "Bearer njcli_test_device_1");
  const config = JSON.parse(await fs.readFile(f.config, "utf8"));
  assert.equal(config.baseUrl, f.url);
  assert.equal(config.deviceToken, "njcli_test_device_1");
  assert.equal(config.loginSource, "BROWSER");
  await assertPrivateConfig(f.config);
  assert.ok(!("password" in config));
  await fs.writeFile(path.join(f.directory, "main source.txt"), code);
  const second = await f.run(["--problem", "B", "--language", "cpp", "main source.txt"], { input: "y\n" });
  success(second);
  assert.doesNotMatch(second.stdout, /Pairing code/);
  assert.equal(f.requests[4].payload.problem, "B");
  assert.equal(f.requests.filter((r) => r.method === "POST" && r.path === "/api/cli/device").length, 1);
  const status = await f.run(["status"]);
  success(status);
  assert.match(status.stdout, /Authorization: ready/);
  assert.ok(!status.stdout.includes("njcli_"));
  success(await f.run(["logout"]));
  assert.equal(f.requests.at(-1).method, "DELETE");
  await assert.rejects(fs.access(f.config));
  assert.match((await f.run(["status"])).stdout, /Not connected/);
});

test("monitoring-client authorization submits only after y and never starts browser pairing", { skip: !windows }, async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.method === "GET") { send(response, proctoringReady); return; }
    return false;
  });
  await f.bindProctoring({ loginSource: undefined, expiresAt: new Date(Date.now() + 60000).toISOString() });
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const cancelled = await f.run(["A.cpp"], { onPrompt(child) {
    assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [["GET", "/api/cli/device"]]);
    child.stdin.end("n\n");
  } });
  success(cancelled);
  assert.match(cancelled.stdout, /Cancelled/);
  assert.doesNotMatch(cancelled.stdout, /Pairing code|Sign in to your team in the browser/);
  const saved = JSON.parse(await fs.readFile(f.config, "utf8"));
  assert.equal(saved.loginSource, "PROCTORING");
  assert.equal(saved.expiresAt, proctoringReady.expiresAt);
  assert.equal(saved.deviceToken, "njcli_monitor_device");
  await assertPrivateConfig(f.config);
  const submitted = await f.run(["A.cpp"], { input: "y\n" });
  success(submitted);
  assert.match(submitted.stdout, /Submit this file\? \[y\/N\]/);
  assert.match(submitted.stdout, /Submitted #9 A cpp/);
  assert.ok(submitted.stdout.includes(`${f.url}/contest/17/status/9`));
  assert.equal(f.requests.at(-1).headers.authorization, "Bearer njcli_monitor_device");
  const status = await f.run(["status"]);
  success(status);
  assert.match(status.stdout, /Authorization source: monitoring client/);
  assert.equal(f.requests.filter((r) => r.method === "POST" && r.path === "/api/cli/device").length, 0);
});

test("unavailable monitored authorization directs users to the monitoring client without pairing or uploading", { skip: !windows }, async (t) => {
  const cases = [
    { body: { status: "expired" } },
    { body: { status: "contest_changed" } },
    { body: { status: "pending" } },
    { body: { status: "disabled", code: "REAUTH_REQUIRED" } },
    { body: { status: "disabled", code: "CLI_DISABLED" }, admin: true },
    { body: { error: "Revoked", code: "INVALID_DEVICE_TOKEN" }, status: 401 },
    { body: { error: "Expired", code: "DEVICE_EXPIRED" }, status: 410 },
    { body: { error: "Account changed", code: "REAUTH_REQUIRED" }, status: 403 },
    { body: { error: "Unavailable" }, status: 503 },
  ];
  let scenario = cases[0];
  const f = await fixture(t, (_request, response) => send(response, scenario.body, scenario.status || 200));
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const current of cases) {
    scenario = current;
    const start = f.requests.length;
    const result = await f.run(["A.cpp"], { input: "y\n" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, current.admin ? /Contact the administrator/ : /Reconnect through the monitoring client/);
    assert.doesNotMatch(result.stdout, /Pairing code|Submit this file/);
    assert.deepEqual(f.requests.slice(start).map((r) => [r.method, r.path]), [["GET", "/api/cli/device"]]);
  }
  scenario = cases[1];
  const status = await f.run(["status"]);
  success(status);
  assert.match(status.stdout, /Authorization source: monitoring client/);
  assert.match(status.stdout, /Reconnect through the monitoring client/);
});

test("monitored configs cannot start explicit browser login or pair when credentials are incomplete", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const args of [["login"], ["login", "--url", "https://another.example"]]) {
    const result = await f.run(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Reconnect through the monitoring client/);
  }
  await f.bindProctoring({ deviceToken: "" });
  const missingToken = await f.run(["A.cpp"], { input: "y\n" });
  assert.equal(missingToken.code, 1);
  assert.match(missingToken.stderr, /Reconnect through the monitoring client/);
  const status = await f.run(["status"]);
  success(status);
  assert.match(status.stdout, /Reconnect through the monitoring client/);
  assert.equal(f.requests.length, 0);
});

test("monitored authorization rejected at submission time never falls back to browser reauthorization", { skip: !windows }, async (t) => {
  const cases = [
    { status: 401, code: "INVALID_DEVICE_TOKEN" },
    { status: 409, code: "CONTEST_CHANGED" },
    { status: 403, code: "REAUTH_REQUIRED" },
    { status: 410, code: "DEVICE_EXPIRED" },
    { status: 409, code: "CLI_DISABLED", admin: true },
  ];
  let scenario = cases[0];
  const f = await fixture(t, (request, response) => {
    if (request.method === "GET") { send(response, proctoringReady); return; }
    send(response, { code: scenario.code, error: "Authorization changed" }, scenario.status);
  });
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const current of cases) {
    scenario = current;
    const start = f.requests.length;
    const result = await f.run(["A.cpp"], { input: "y\ny\n" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, current.admin ? /Contact the administrator/ : /Reconnect through the monitoring client/);
    assert.equal(result.stdout.match(/Submit this file\? \[y\/N\]/g).length, 1);
    assert.doesNotMatch(result.stdout, /Pairing code|Browser authorization must be renewed/);
    assert.deepEqual(f.requests.slice(start).map((r) => [r.method, r.path]), [
      ["GET", "/api/cli/device"], ["POST", "/api/cli/device/submit"],
    ]);
  }
});

test("help and invalid local source/arguments never trigger browser pairing", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.config, "bad json");
  await fs.writeFile(f.defaults, "bad json");
  for (const args of [[], ["--help"], ["login", "-h"], ["status", "--help"]]) {
    const result = await f.run(args);
    success(result);
    assert.match(result.stdout, /native Windows/);
    assert.doesNotMatch(result.stdout, /--password-stdin|--contest /);
  }
  for (const args of [["--problem"], ["--unknown", "A.cpp"], ["missing.cpp"], ["A.cpp", "B.cpp"], ["login", "--user", "team"]]) {
    const result = await f.run(args);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /execution error|Invalid JSON/);
  }
  assert.equal(f.requests.length, 0);
});

test("only an explicit y submits; cancellation and closed input never upload source", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const input of ["n\n", "\n", "", "y", "yes\nn\n"]) {
    const result = await f.run(["A.cpp"], { input });
    success(result);
    assert.match(result.stdout, /Cancelled. Nothing was submitted/);
    assert.equal(f.requests.filter((r) => r.path.endsWith("/submit")).length, 0);
  }
  const confirmed = await f.run(["A.cpp"], { input: "maybe\n是\nY\n" });
  success(confirmed);
  assert.equal(confirmed.stdout.match(/Please enter y or n/g).length, 2);
  assert.equal(f.requests.filter((r) => r.path.endsWith("/submit")).length, 1);
});

test("a new contest is displayed and must be confirmed again after rebinding", { skip: !windows }, async (t) => {
  let switched = false;
  const nextContest = { id: 18, title: "Next Contest" };
  const f = await fixture(t, (request, response) => {
    if (request.url.endsWith("/submit")) {
      switched = true;
      send(response, { error: "Contest changed", code: "CONTEST_CHANGED" }, 409); return;
    }
    if (switched && request.method === "GET") { send(response, { ...ready, contest: nextContest }); return; }
    return false;
  });
  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const result = await f.run(["A.cpp"], { input: "y\nn\n" });
  success(result);
  assert.match(result.stdout, /Contest: #17 Current Contest/);
  assert.match(result.stdout, /Contest: #18 Next Contest/);
  assert.equal(result.stdout.match(/Submit this file\? \[y\/N\]/g).length, 2);
  assert.match(result.stdout, /Cancelled/);
  assert.equal(f.requests.filter((r) => r.path.endsWith("/submit")).length, 1);
});

test("result links use the contest display number even if an older server returns a UUID link", { skip: !windows }, async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.url.endsWith("/submit")) {
      send(response, { submission: { id: "uuid-from-server", displayId: 27 }, statusUrl: "/contest/17/status/uuid-from-server" }); return;
    }
    return false;
  });
  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const result = await f.run(["A.cpp"], { input: "y\n" });
  success(result);
  assert.match(result.stdout, /Submitted #27 A cpp/);
  assert.ok(result.stdout.includes(`${f.url}/contest/17/status/27`));
  assert.doesNotMatch(result.stdout, /uuid-from-server/);
});

test("URL precedence and installed defaults", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  success(await f.run(["login"]));
  await fs.writeFile(f.defaults, JSON.stringify({ baseUrl: "http://127.0.0.1:1" }));
  success(await f.run(["login"], { env: { NOVAJUDGE_URL: f.url } }));
  success(await f.run(["login", "--url", f.url + "/"], { env: { NOVAJUDGE_URL: "http://127.0.0.1:1" } }));
  const invalid = await f.run(["login", "--url", "file:///tmp/secret"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Server URL must/);
  assert.equal(f.requests.length, 6);
});

test("pending authorization polls until browser approval", { skip: !windows }, async (t) => {
  let polls = 0;
  const f = await fixture(t, (request, response) => {
    if (request.method === "GET" && polls++ === 0) { send(response, { status: "pending", contest }); return; }
    return false;
  });
  const result = await f.run(["login"]);
  success(result);
  assert.match(result.stdout, /Waiting for browser authorization/);
  assert.match(result.stdout, /Browser authorization complete/);
  assert.equal(polls, 2);
});

test("changed contest and expired devices automatically rebind before submission", { skip: !windows }, async (t) => {
  for (const initial of ["contest_changed", "expired"]) {
    let first = true;
    const f = await fixture(t, (request, response) => {
      if (request.method === "GET" && first) { first = false; send(response, { status: initial }); return; }
      return false;
    });
    await f.bind();
    await fs.writeFile(path.join(f.directory, "A.py"), "print(1)\n");
    const result = await f.run(["A.py"], { input: "y\n" });
    success(result);
    assert.match(result.stdout, /Pairing code/);
    assert.deepEqual(f.requests.map((r) => r.method), ["GET", "POST", "GET", "POST"]);
    assert.equal(f.requests.at(-1).payload.language, "pypy3");
  }
});

test("a contest switch at submit time requires a fresh browser authorization before retry", { skip: !windows }, async (t) => {
  let submissions = 0;
  const f = await fixture(t, (request, response) => {
    if (request.url.endsWith("/submit") && submissions++ === 0) {
      send(response, { error: "Contest changed", code: "CONTEST_CHANGED" }, 409); return;
    }
    return false;
  });
  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const result = await f.run(["A.cpp"], { input: "y\ny\n" });
  success(result);
  assert.equal(result.stdout.match(/Submit this file\? \[y\/N\]/g).length, 2);
  assert.equal(submissions, 2);
  assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [
    ["GET", "/api/cli/device"], ["POST", "/api/cli/device/submit"], ["POST", "/api/cli/device"],
    ["GET", "/api/cli/device"], ["POST", "/api/cli/device/submit"]
  ]);
});

test("disabled current contest stops; reauthorization requirement opens a new binding", { skip: !windows }, async (t) => {
  let state = { status: "disabled", code: "CLI_DISABLED" };
  const f = await fixture(t, (request, response) => {
    if (request.method === "GET" && state) { const current = state; state = null; send(response, current); return; }
    return false;
  });
  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const disabled = await f.run(["A.cpp"]);
  assert.equal(disabled.code, 1);
  assert.match(disabled.stderr, /administrator/);
  assert.equal(f.requests.length, 1);
  state = { status: "disabled" };
  const unknown = await f.run(["A.cpp"]);
  assert.equal(unknown.code, 1);
  assert.equal(f.requests.length, 2);
  state = { status: "disabled", code: "REAUTH_REQUIRED" };
  success(await f.run(["A.cpp"], { input: "y\n" }));
  assert.equal(f.requests.length, 6);
});

test("foreign or token-bearing verification URLs are rejected before saving authorization", { skip: !windows }, async (t) => {
  for (const verificationPath of ["//evil.example/cli/connect", "https://evil.example/cli/connect", "/\\evil.example", "/cli/connect?code=ABCD-1234&token=njcli_secret"]) {
    const f = await fixture(t, (_request, response) => send(response, pairing(1, { verificationPath })));
    const result = await f.run(["login"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /invalid browser verification path/);
    assert.ok(!result.stdout.includes("njcli_"));
    await assert.rejects(fs.access(f.config));
  }
});

test("logout removes local authorization even when revocation fails", { skip: !windows }, async (t) => {
  const f = await fixture(t, (_request, response) => send(response, { error: "Temporarily unavailable" }, 503));
  await f.bind();
  const result = await f.run(["logout"]);
  success(result);
  assert.match(result.stderr, /will still be removed locally/);
  await assert.rejects(fs.access(f.config));
  await fs.writeFile(f.config, "bad json");
  success(await f.run(["logout"]));
  await assert.rejects(fs.access(f.config));
});

test("no selected contest, failed connection, expired pairing are clear", { skip: !windows }, async (t) => {
  let mode = "disabled";
  const f = await fixture(t, (request, response) => {
    if (mode === "disabled") { send(response, { error: "Ask the administrator to select a current contest", code: "CLI_DISABLED" }, 409); return; }
    if (mode === "expired") {
      send(response, request.method === "POST" ? pairing(1, { expiresAt: new Date(Date.now() - 1).toISOString() }) : { status: "pending" }); return;
    }
    return false;
  });
  const disabled = await f.run(["login"]);
  assert.equal(disabled.code, 1);
  assert.match(disabled.stderr, /administrator/);
  const offline = await f.run(["login", "--url", "http://127.0.0.1:1"]);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /Cannot reach/);
  mode = "expired";
  const expired = await f.run(["login"]);
  assert.equal(expired.code, 1);
  assert.match(expired.stderr, /Pairing code expired/);
});

test("invalid UTF-8 source is rejected locally without pairing or uploading", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, "A.cpp"), Buffer.from([0x2f, 0x2f, 0x20, 0xc3, 0x28, 0x0a]));
  const result = await f.run(["A.cpp"], { input: "y\n" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read UTF-8 text/);
  assert.equal(f.requests.length, 0);
  await assert.rejects(fs.access(f.config));
});

test("single-object JSON arrays are rejected as config and server responses", { skip: !windows }, async (t) => {
  let responseArray = false;
  const f = await fixture(t, (request, response) => {
    if (!responseArray) return false;
    send(response, [request.method === "POST" ? pairing() : ready]);
  });
  const original = JSON.stringify([{ baseUrl: f.url, ...pairing(), ...ready }]);
  await fs.writeFile(f.config, original);
  const local = await f.run(["status"]);
  assert.equal(local.code, 1);
  assert.match(local.stderr, /Invalid JSON file|Expected a JSON object/);
  assert.equal(f.requests.length, 0);
  assert.equal(await fs.readFile(f.config, "utf8"), original);

  await fs.unlink(f.config);
  responseArray = true;
  const pairingResult = await f.run(["login"]);
  assert.equal(pairingResult.code, 1);
  assert.match(pairingResult.stderr, /non-JSON response|Invalid server response/);
  assert.equal(f.requests.length, 1);
  await assert.rejects(fs.access(f.config));

  await f.bind();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  const stateResult = await f.run(["A.cpp"], { input: "y\n" });
  assert.equal(stateResult.code, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests.at(-1).method, "GET");
  assert.doesNotMatch(stateResult.stdout + stateResult.stderr, /njcli_test_device/);
});

test("HTTP redirects never forward device credentials or source to another endpoint", { skip: !windows }, async (t) => {
  const leaked = [];
  const trap = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    leaked.push({ headers: request.headers, body });
    send(response, ready);
  });
  await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    trap.closeAllConnections();
    await new Promise((resolve) => trap.close(resolve));
  });
  const externalTarget = `http://127.0.0.1:${trap.address().port}/leak`;
  let scenario = { method: "GET", status: 302, target: externalTarget };
  const f = await fixture(t, (request, response) => {
    if (request.method !== scenario.method) return false;
    response.writeHead(scenario.status, { Location: scenario.target, "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Redirect rejected" }));
  });
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "// private-source-marker\nint main(){}\n");
  for (const current of [
    { method: "GET", status: 302, target: externalTarget },
    { method: "POST", status: 307, target: `${f.url}/leak` },
    { method: "POST", status: 307, target: externalTarget },
  ]) {
    scenario = current;
    const start = f.requests.length;
    const result = await f.run(["A.cpp"], { input: "y\n" });
    assert.equal(result.code, 1);
    assert.deepEqual(f.requests.slice(start).map((request) => request.path),
      current.method === "GET" ? ["/api/cli/device"] : ["/api/cli/device", "/api/cli/device/submit"]);
    assert.deepEqual(leaked, [], "redirect destinations must receive no request, token, or source");
    assert.doesNotMatch(result.stdout + result.stderr, /njcli_monitor_device|private-source-marker/);
  }
});

test("printfile shows a Chinese spaced path without source and queues the original snapshot using monitored credentials", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring({ contest: { id: 99, title: "Stale local contest" } });
  const directory = path.join(f.directory, "中文 代码");
  await fs.mkdir(directory);
  const filename = "测试 文件.cpp";
  const fullpath = path.join(directory, filename);
  const code = '#include <iostream>\n// 中文 & "quoted" \\ code\nint main() {\n\tstd::cout << "ok";\n}\n';
  await fs.writeFile(fullpath, code);
  const result = await f.run(["printfile", fullpath], { async onPrompt(child, output) {
    assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [["GET", "/api/cli/device/print"]]);
    assert.match(output, /Contest: #17 Current Contest/);
    assert.match(output, /Team: Test Team \(team001\)/);
    assert.ok(output.includes(`File: ${filename}\nSize: ${Buffer.byteLength(code)} bytes\nLanguage: C++`));
    assert.doesNotMatch(output, /#include|std::cout|Begin file content/);
    // A file edited during confirmation must not silently change the upload.
    await fs.writeFile(fullpath, "int changed_after_preview;\n");
    child.stdin.end("y\n");
  } });
  success(result);
  assert.match(result.stdout, /Print request print-job-123 entered the NovaJudge print queue/);
  assert.doesNotMatch(result.stdout, /Stale local contest|njcli_|Pairing code|browser authorization|#include|std::cout|changed_after_preview/);
  assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [
    ["GET", "/api/cli/device/print"], ["POST", "/api/cli/device/print"],
  ]);
  assert.deepEqual(f.requests[1].payload, { sourceFilename: filename, code });
  assert.equal(f.requests[1].headers.authorization, "Bearer njcli_monitor_device");
});

test("printfile accepts only the six source suffixes and displays inferred language before positional confirmation", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring();
  for (const [extension, language] of [["c", "C"], ["cc", "C++"], ["cpp", "C++"], ["cxx", "C++"], ["java", "Java"], ["py", "Python"]]) {
    const filename = `source.${extension}`;
    const code = `// source ${extension}\n`;
    await fs.writeFile(path.join(f.directory, filename), code);
    const result = await f.run(["printfile", filename, "Y"]);
    success(result);
    assert.ok(result.stdout.includes(`Language: ${language}\n`));
    assert.ok(result.stdout.indexOf(`File: ${filename}`) < result.stdout.indexOf("Print this file? [y/N] Y"));
    assert.ok(!result.stdout.includes(code.trimEnd()), "source contents must not be printed to the terminal");
    assert.deepEqual(f.requests.at(-1).payload, { sourceFilename: filename, code });
  }
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 6);
});

test("printfile N, Enter, EOF and unterminated y cancel without uploading any source", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.py"), "print('private source')\n");
  for (const input of ["n\n", "N\n", "\n", "", "y", "yes\nn\n"]) {
    const result = await f.run(["printfile", "A.py"], { input });
    success(result);
    assert.doesNotMatch(result.stdout, /private source/);
    assert.match(result.stdout, /Cancelled. Nothing was sent for printing/);
  }
  const positionalCancel = await f.run(["printfile", "A.py", "N"], { input: "y\n" });
  success(positionalCancel);
  assert.match(positionalCancel.stdout, /Print this file\? \[y\/N\] N/);
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
  const confirmed = await f.run(["printfile", "A.py"], { input: "maybe\n是\nY\n" });
  success(confirmed);
  assert.equal(confirmed.stdout.match(/Please enter y or n/g).length, 2);
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 1);
});

test("printfile never pairs an unbound or browser-authorized device", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const setup of [async () => {}, () => f.bind(), () => f.bindProctoring({ deviceToken: "" })]) {
    await setup();
    const result = await f.run(["printfile", "A.cpp", "y"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Reconnect through the monitoring client/);
    assert.doesNotMatch(result.stdout, /Pairing code|Print this file|int main/);
    assert.deepEqual(f.requests, []);
  }
  // Old monitor installs without a local loginSource still require server proof.
  await f.bindProctoring({ loginSource: undefined });
  success(await f.run(["printfile", "A.cpp", "y"]));
  assert.deepEqual(f.requests.map((r) => [r.method, r.path]), [
    ["GET", "/api/cli/device/print"], ["POST", "/api/cli/device/print"],
  ]);
});

test("printfile rejects forged local monitor markers, expired authorization and malformed server context", { skip: !windows }, async (t) => {
  const scenarios = [
    { status: 403, body: { code: "PROCTORING_REQUIRED", error: "Monitoring-client login required" } },
    { status: 401, body: { code: "INVALID_DEVICE_TOKEN", error: "Expired token" } },
    { status: 410, body: { code: "DEVICE_EXPIRED", error: "Expired token" } },
    { status: 409, body: { code: "CLI_DISABLED", error: "Intranet printing is disabled" } },
    { status: 200, body: { ...proctoringReady, loginSource: "BROWSER" } },
    { status: 200, body: { ...proctoringReady, contest: undefined } },
    { status: 200, body: { ...proctoringReady, user: {} } },
  ];
  let scenario = scenarios[0];
  const f = await fixture(t, (_request, response) => send(response, scenario.body, scenario.status));
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int private_source;\n");
  for (const current of scenarios) {
    scenario = current;
    const start = f.requests.length;
    const result = await f.run(["printfile", "A.cpp", "y"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Reconnect through the monitoring client/);
    assert.doesNotMatch(result.stdout, /Pairing code|Print this file|private_source/);
    assert.deepEqual(f.requests.slice(start).map((r) => [r.method, r.path]), [["GET", "/api/cli/device/print"]]);
  }
});

test("printfile rejects invalid local files, UTF-8, byte/character limits, controls and extra arguments before network access", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring();
  const cases = [
    { file: "wrong.txt", code: "text", error: /accepts only/ },
    { file: "wrong.py3", code: "print(1)", error: /accepts only/ },
    { file: "wrong.cpp.exe", code: "text", error: /accepts only/ },
    { file: "empty.cpp", code: " \r\n\t", error: /empty/ },
    { file: "large.cpp", code: "中".repeat(40001), error: /120000 byte/ },
    { file: "long.cpp", code: "x".repeat(100001), error: /100000 character/ },
    { file: "utf8.cpp", code: Buffer.from([0xc3, 0x28]), error: /Cannot read UTF-8/ },
    { file: "contains-nul.cpp", code: "int a;\0", error: /control characters/ },
    { file: "esc.cpp", code: "// \x1b[2J int a;", error: /control characters/ },
    { file: "bell.cpp", code: "// \x07 int a;", error: /control characters/ },
    { file: "c1.cpp", code: "// \u009b2J int a;", error: /control characters/ },
    { file: "del.cpp", code: "// \x7f int a;", error: /control characters/ },
  ];
  for (const entry of cases) {
    await fs.writeFile(path.join(f.directory, entry.file), entry.code);
    const result = await f.run(["printfile", entry.file, "y"]);
    assert.equal(result.code, 1, entry.file);
    assert.match(result.stderr, entry.error);
    assert.doesNotMatch(result.stdout + result.stderr, /\x1b|\u009b|\x07/);
  }
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const args of [[], ["A.cpp", "yes"], ["A.cpp", "y", "extra"], ["--unknown", "A.cpp"], ["missing.cpp"]]) {
    assert.equal((await f.run(["printfile", ...args])).code, 1);
  }
  assert.deepEqual(f.requests, []);
});

test("printfile accepts the exact UTF-8 byte and character limits", { skip: !windows }, async (t) => {
  const f = await fixture(t);
  await f.bindProctoring();
  for (const code of ["中".repeat(40000), "x".repeat(100000)]) {
    await fs.writeFile(path.join(f.directory, "limit.cpp"), code);
    const result = await f.run(["printfile", "limit.cpp", "y"]);
    success(result);
    assert.equal(f.requests.at(-1).payload.code, code);
    assert.ok(result.stdout.includes(`Size: ${Buffer.byteLength(code)} bytes`));
  }
});

test("printfile preserves BOM-stripped source and CR line endings without displaying code and sanitizes server labels", { skip: !windows }, async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.url.endsWith("/print") && request.method === "GET") {
      send(response, { ...proctoringReady, contest: { ...contest, title: "Contest\x1b[2J" }, user: { ...user, displayName: "Team\u009b2J" } });
      return;
    }
    return false;
  });
  await f.bindProctoring();
  const code = "// first\r\n// second\rint main(){}\n\t// end\n";
  const bytes = Buffer.from("\ufeff" + code);
  await fs.writeFile(path.join(f.directory, "A.cpp"), bytes);
  const result = await f.run(["printfile", "A.cpp", "y"]);
  success(result);
  assert.ok(result.stdout.includes(`Size: ${bytes.length} bytes`));
  assert.doesNotMatch(result.stdout, /\/\/ first|\/\/ second|int main|\/\/ end/);
  assert.match(result.stdout, /Contest\?\[2J/);
  assert.match(result.stdout, /Team\?2J/);
  assert.doesNotMatch(result.stdout, /\x1b|\u009b|\ufeff/);
  assert.equal(f.requests.at(-1).payload.code, code);
});

test("printfile never retries a failed POST or starts browser pairing, including ambiguous network failures", { skip: !windows }, async (t) => {
  const scenarios = [
    { status: 401, code: "INVALID_DEVICE_TOKEN", auth: true },
    { status: 403, code: "PROCTORING_REQUIRED", auth: true },
    { status: 409, code: "CONTEST_CHANGED", auth: true },
    { status: 410, code: "DEVICE_EXPIRED", auth: true },
    { status: 503, code: "UNAVAILABLE" },
    { status: 307, code: "REDIRECT" },
    { disconnect: true },
    { invalidSuccess: true },
  ];
  let scenario = scenarios[0];
  const f = await fixture(t, (request, response) => {
    if (request.method !== "POST") return false;
    if (scenario.disconnect) { request.socket.destroy(); return; }
    if (scenario.invalidSuccess) { send(response, { success: true }); return; }
    if (scenario.status === 307) response.setHeader("Location", "/redirect-trap");
    send(response, { code: scenario.code, error: "Request failed\x1b[2J" }, scenario.status);
  });
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const current of scenarios) {
    scenario = current;
    const start = f.requests.length;
    const result = await f.run(["printfile", "A.cpp", "y"], { input: "y\ny\n" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Check the NovaJudge print queue before trying again/);
    if (current.auth) assert.match(result.stderr, /Reconnect through the monitoring client/);
    assert.doesNotMatch(result.stdout + result.stderr, /Pairing code|\x1b|njcli_/);
    assert.deepEqual(f.requests.slice(start).map((r) => [r.method, r.path]), [
      ["GET", "/api/cli/device/print"], ["POST", "/api/cli/device/print"],
    ]);
  }
});

test("printfile rejects a false success response even when it contains a print job ID", { skip: !windows }, async (t) => {
  let successValue = false;
  const f = await fixture(t, (request, response) => {
    if (request.method !== "POST") return false;
    send(response, { success: successValue, printJob: { id: "not-accepted-print-job" }, contest });
  });
  await f.bindProctoring();
  await fs.writeFile(path.join(f.directory, "A.cpp"), "int main(){}\n");
  for (const value of [false, "true"]) {
    successValue = value;
    const start = f.requests.length;
    const result = await f.run(["printfile", "A.cpp", "y"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no valid print confirmation/);
    assert.match(result.stderr, /Check the NovaJudge print queue before trying again/);
    assert.doesNotMatch(result.stdout, /entered the NovaJudge print queue|not-accepted-print-job|int main/);
    assert.deepEqual(f.requests.slice(start).map((r) => [r.method, r.path]), [
      ["GET", "/api/cli/device/print"], ["POST", "/api/cli/device/print"],
    ]);
  }
});

test("printfile renders bidirectional filename and server labels without terminal formatting controls", { skip: !windows }, async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.method === "GET") {
      send(response, { ...proctoringReady, contest: { ...contest, title: "Contest\u202eSafe" }, user: { ...user, displayName: "Team\u2066Safe\u2069" } });
      return;
    }
    return false;
  });
  await f.bindProctoring();
  const filename = "name\u202etest.cpp";
  await fs.writeFile(path.join(f.directory, filename), "int main(){}\n");
  const result = await f.run(["printfile", filename, "y"]);
  success(result);
  assert.match(result.stdout, /File: name\?test.cpp/);
  assert.match(result.stdout, /Contest\?Safe/);
  assert.match(result.stdout, /Team\?Safe\?/);
  assert.doesNotMatch(result.stdout, /[\u202a-\u202e\u2066-\u2069]|int main/);
  assert.equal(f.requests.at(-1).payload.sourceFilename, filename);
});
