import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const installer = fileURLToPath(new URL("../tools/contestant-cli/install-windows.ps1", import.meta.url));
const fixture = '# NovaJudge native Windows submit\nWrite-Output "native submit fixture"\n';
const launcher = '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0submit.ps1" %*\r\n';
const windows = { skip: process.platform !== "win32", timeout: 90_000 };

function run(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}
const command = (source, env) => run(["-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")], env);
const read = file => readFile(file, "utf8");
async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    result[entry.name] = entry.isDirectory() ? await snapshot(path.join(directory, entry.name)) : await read(path.join(directory, entry.name));
  }
  return result;
}

test("Windows installer: download, spaces, PowerShell command resolution, update, failure safety and uninstall", windows, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "submit installer's 中文 home "));
  const env = { ...process.env, LOCALAPPDATA: root, USERPROFILE: root };
  const directory = path.join(root, "NovaJudge/submit");
  const config = path.join(root, ".novajudge-submit.json");
  const defaults = path.join(directory, "submit-defaults.json");
  const requests = [];
  let body = fixture;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://local.test");
    requests.push(url);
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(url.searchParams.get("file") === "submit.ps1" ? body : launcher);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const install = (...args) => run(["-File", installer, "-NoPathUpdate", ...args], env);
  const readUserPath = () => command('[Console]::Write([Environment]::GetEnvironmentVariable("Path", "User"))');
  const userPathBefore = await readUserPath();
  try {
    await writeFile(config, '{"deviceToken":"test-only","loginSource":"PROCTORING"}\n');
    const installed = await install("-Url", url);
    assert.equal(installed.code, 0, installed.stderr);
    assert.deepEqual(JSON.parse(await read(defaults)), { baseUrl: url });
    assert.equal(requests.length, 3);
    for (const req of requests) {
      assert.equal(req.pathname, "/api/cli/download");
      assert.equal(req.searchParams.get("platform"), "windows");
      assert(["submit.ps1", "submit.cmd", "submit.bat"].includes(req.searchParams.get("file")));
    }
    await assert.rejects(stat(path.join(directory, "submit.ps1")), { code: "ENOENT" });
    const invoked = await command('$env:Path = "$env:LOCALAPPDATA\\NovaJudge\\submit;$env:Path"; (Get-Command submit).Extension; submit --help', env);
    assert.equal(invoked.code, 0, invoked.stderr);
    assert.match(invoked.stdout, /\.(cmd|bat)/);
    assert.match(invoked.stdout, /native submit fixture/);
    assert.equal((await install("-Url", url + "/alternate/")).code, 0);
    assert.equal(JSON.parse(await read(defaults)).baseUrl, url + "/alternate");
    const previous = await snapshot(directory);
    body = "<html>not a script</html>";
    const rejected = await install("-Url", url);
    assert.notEqual(rejected.code, 0);
    assert.deepEqual(await snapshot(directory), previous);
    assert.deepEqual(await readdir(path.dirname(directory)), ["submit"]);
    for (const invalid of ["file:///C:/test", "https://user:pass@example.com", "https://example.com?x=1", "https://example.com/#fragment"]) {
      assert.notEqual((await install("-Url", invalid)).code, 0);
      assert.deepEqual(await snapshot(directory), previous);
    }
    await writeFile(path.join(directory, "unrelated.txt"), "preserve me");
    assert.notEqual((await install("-Uninstall")).code, 0);
    assert.equal(await read(path.join(directory, "unrelated.txt")), "preserve me");
    await rm(path.join(directory, "unrelated.txt"));
    assert.equal((await install("-Uninstall")).code, 0);
    await assert.rejects(stat(directory), { code: "ENOENT" });
    assert.match(await read(config), /test-only/);
    assert.equal((await install("-Uninstall")).code, 0);
    await mkdir(directory);
    await writeFile(path.join(directory, "submit.cmd"), "unrelated command");
    body = fixture;
    assert.notEqual((await install("-Url", url)).code, 0);
    assert.notEqual((await install("-Uninstall")).code, 0);
    assert.equal(await read(path.join(directory, "submit.cmd")), "unrelated command");
    assert.equal((await readUserPath()).stdout, userPathBefore.stdout, "isolated tests must not alter real user PATH");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("offline Windows installation never downloads and preserves monitoring credentials", windows, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "submit offline 中文 "));
  const env = { ...process.env, LOCALAPPDATA: root, USERPROFILE: root };
  const bundle = path.join(root, "bundle");
  const directory = path.join(root, "NovaJudge/submit");
  const config = path.join(root, ".novajudge-submit.json");
  const credentials = '{"deviceToken":"test-only","loginSource":"PROCTORING"}\n';
  try {
    await mkdir(bundle);
    await writeFile(path.join(bundle, "submit.ps1"), fixture);
    await writeFile(path.join(bundle, "submit.cmd"), launcher);
    await writeFile(path.join(bundle, "submit.bat"), launcher);
    await writeFile(config, credentials);
    const installed = await run(["-File", installer, "-NoPathUpdate", "-Url", "http://127.0.0.1:1", "-SourceDir", bundle], env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(await read(config), credentials);
    assert.equal(JSON.parse(await read(path.join(directory, "submit-defaults.json"))).baseUrl, "http://127.0.0.1:1");
    assert.match(await read(path.join(directory, "novajudge-submit.ps1")), /native submit fixture/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
