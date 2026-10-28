import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = fileURLToPath(new URL("./submit-macos", import.meta.url));
const mac = process.platform === "darwin";
const contest = { id: 17, title: "Current Contest" };
const user = { username: "team001", displayName: "Test Team" };
const ready = { status: "ready", loginSource: "BROWSER", contest, user, expiresAt: new Date(Date.now() + 86400000).toISOString() };
const proctoringReady = { ...ready, loginSource: "PROCTORING" };

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
  const script = path.join(installed, "submit");
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
      const child = spawn(command, args, { cwd: directory, detached: true, env: { ...process.env, HOME: home,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NOVAJUDGE_URL: "", NOVAJUDGE_NO_BROWSER: "1", ...env } });
      let stdout = "", stderr = "", prompted = false;
      const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } };
      const timeout = setTimeout(() => { stop(); reject(new Error(`Native CLI timed out: ${stdout}${stderr}`)); }, 30000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (onPrompt && !prompted && stdout.includes("Submit this file? [y/N]")) {
          prompted = true;
          try { onPrompt(child, stdout); } catch (error) { stop(); reject(error); }
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

// Only the test runner uses Node. Every client subprocess has a system-only PATH.
test("first submit pairs in browser; later submits reuse authorization and server-selected contest", { skip: !mac }, async (t) => {
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
  assert.equal((await fs.stat(f.config)).mode & 0o777, 0o600);
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

test("monitoring-client authorization submits only after y and never starts browser pairing", { skip: !mac }, async (t) => {
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
  assert.equal((await fs.stat(f.config)).mode & 0o777, 0o600);
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

test("unavailable monitored authorization directs users to the monitoring client without pairing or uploading", { skip: !mac }, async (t) => {
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

test("monitored configs cannot start explicit browser login or pair when credentials are incomplete", { skip: !mac }, async (t) => {
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

test("monitored authorization rejected at submission time never falls back to browser reauthorization", { skip: !mac }, async (t) => {
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

test("help and invalid local source/arguments never trigger browser pairing", { skip: !mac }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.config, "bad json");
  await fs.writeFile(f.defaults, "bad json");
  for (const args of [[], ["--help"], ["login", "-h"], ["status", "--help"]]) {
    const result = await f.run(args);
    success(result);
    assert.match(result.stdout, /native macOS/);
    assert.doesNotMatch(result.stdout, /--password-stdin|--contest /);
  }
  for (const args of [["--problem"], ["--unknown", "A.cpp"], ["missing.cpp"], ["A.cpp", "B.cpp"], ["login", "--user", "team"]]) {
    const result = await f.run(args);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /execution error|Invalid JSON/);
  }
  assert.equal(f.requests.length, 0);
});

test("only an explicit y submits; cancellation and closed input never upload source", { skip: !mac }, async (t) => {
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

test("a new contest is displayed and must be confirmed again after rebinding", { skip: !mac }, async (t) => {
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

test("result links use the contest display number even if an older server returns a UUID link", { skip: !mac }, async (t) => {
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

test("URL precedence and symlink resolve installed defaults", { skip: !mac }, async (t) => {
  const f = await fixture(t);
  const link = path.join(f.directory, "submit-link");
  await fs.symlink(f.script, link);
  success(await f.run(["login"], { command: link }));
  await fs.writeFile(f.defaults, JSON.stringify({ baseUrl: "http://127.0.0.1:1" }));
  success(await f.run(["login"], { env: { NOVAJUDGE_URL: f.url } }));
  success(await f.run(["login", "--url", f.url + "/"], { env: { NOVAJUDGE_URL: "http://127.0.0.1:1" } }));
  const invalid = await f.run(["login", "--url", "file:///tmp/secret"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Server URL must/);
  assert.equal(f.requests.length, 6);
});

test("pending authorization polls until browser approval", { skip: !mac }, async (t) => {
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

test("changed contest and expired devices automatically rebind before submission", { skip: !mac }, async (t) => {
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

test("a contest switch at submit time requires a fresh browser authorization before retry", { skip: !mac }, async (t) => {
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

test("disabled current contest stops; reauthorization requirement opens a new binding", { skip: !mac }, async (t) => {
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

test("foreign or token-bearing verification URLs are rejected before saving authorization", { skip: !mac }, async (t) => {
  for (const verificationPath of ["//evil.example/cli/connect", "https://evil.example/cli/connect", "/\\evil.example", "/cli/connect?code=ABCD-1234&token=njcli_secret"]) {
    const f = await fixture(t, (_request, response) => send(response, pairing(1, { verificationPath })));
    const result = await f.run(["login"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /invalid browser verification path/);
    assert.ok(!result.stdout.includes("njcli_"));
    await assert.rejects(fs.access(f.config));
  }
});

test("logout removes local authorization even when revocation fails", { skip: !mac }, async (t) => {
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

test("no selected contest, failed connection, expired pairing and failed browser opening are clear", { skip: !mac }, async (t) => {
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
  mode = "ready";
  // Simulate LaunchServices failing; the distributed client still calls /usr/bin/open.
  const script = (await fs.readFile(f.script, "utf8")).replace('runTask("/usr/bin/open", [url])', 'runTask("/bin/false", [url])');
  await fs.writeFile(f.script, script);
  const browser = await f.run(["login"], { env: { NOVAJUDGE_NO_BROWSER: "0" } });
  success(browser);
  assert.match(browser.stderr, /Open the URL above manually/);
  assert.match(browser.stdout, /Open: http:\/\/127\.0\.0\.1:/);
});
