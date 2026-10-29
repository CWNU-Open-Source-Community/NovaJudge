import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./submit.mjs", import.meta.url));

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "novajudge legacy cli "));
  await fs.mkdir(path.join(directory, "Desktop"));
  await fs.writeFile(path.join(directory, "A.cpp"), "int main(){}\n");
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(request.url === "/api/cli/login" ? {
      token: "legacy-test-token", user: { username: "team001", contestId: 17 }, contest: { title: "Test Contest" }
    } : { submission: { id: "test-submission", displayId: 1 }, statusUrl: "/contest/17/status/1" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const config = path.join(directory, ".novajudge-submit.json");
  const credentials = path.join(directory, "Desktop", "novajudge-submit.json");
  function run(args, env = {}, password) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...args], { cwd: directory, windowsHide: true,
        env: { ...process.env, HOME: directory, USERPROFILE: directory, NOVAJUDGE_URL: "", ...env } });
      let stdout = "", stderr = "", sent = false;
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Legacy CLI timed out")); }, 10000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (password && !sent && stdout.includes("Password: ")) {
          sent = true;
          child.stdin.end(password + "\n");
        }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
      if (!password) child.stdin.end();
    });
  }
  return { config, credentials, requests, run, url };
}

test("legacy CLI requires a configured URL before asking for credentials or contacting a server", async (t) => {
  const f = await fixture(t);
  const login = await f.run(["login", "--user", "team001"]);
  assert.equal(login.code, 1);
  assert.match(login.stderr, /No server URL configured/);
  assert.doesNotMatch(login.stdout, /Password:/);
  await fs.writeFile(f.credentials, JSON.stringify({ username: "team001", password: "test-only", contestId: 17 }));
  const submit = await f.run(["A.cpp"]);
  assert.equal(submit.code, 1);
  assert.match(submit.stderr, /No server URL configured/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(fs.access(f.config));
  const status = await f.run(["status"]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /Not logged in/);
  const help = await f.run(["--help"]);
  assert.equal(help.code, 0, help.stderr);
});

test("legacy CLI accepts explicit login URLs and configured desktop credential URLs", async (t) => {
  const f = await fixture(t);
  const login = await f.run(["login", "--url", f.url, "--contest", "17", "--user", "team001"], {}, "test-only");
  assert.equal(login.code, 0, login.stderr);
  assert.equal(JSON.parse(await fs.readFile(f.config, "utf8")).baseUrl, f.url);
  await fs.unlink(f.config);
  await fs.writeFile(f.credentials, JSON.stringify({ url: f.url, username: "team001", password: "test-only", contestId: 17 }));
  const submit = await f.run(["A.cpp"]);
  assert.equal(submit.code, 0, submit.stderr);
  assert.match(submit.stdout, /Submitted #1/);
  assert.deepEqual(f.requests.map((r) => r.path), ["/api/cli/login", "/api/cli/login", "/api/cli/submit"]);
  await fs.unlink(f.config);
  await fs.writeFile(f.credentials, JSON.stringify({ username: "team001", password: "test-only", contestId: 17 }));
  const fromEnv = await f.run(["A.cpp"], { NOVAJUDGE_URL: f.url });
  assert.equal(fromEnv.code, 0, fromEnv.stderr);
  assert.equal(JSON.parse(await fs.readFile(f.config, "utf8")).baseUrl, f.url);
});
