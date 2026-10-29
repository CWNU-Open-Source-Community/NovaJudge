import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const installer = await readFile(new URL("../tools/contestant-cli/install-macos.sh", import.meta.url), "utf8");
const fixture = '#!/bin/bash\n# NovaJudge native macOS submit\nprintf "native submit fixture\\n"\nprintf "arg:<%s>\\n" "$@"\n';

function run(command, args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function snapshotTree(directory) {
  const snapshot = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    snapshot[entry.name] = entry.isDirectory()
      ? await snapshotTree(file)
      : { mode: (await stat(file)).mode, contents: await readFile(file, "utf8") };
  }
  return snapshot;
}

test("macOS native installer: clean PATH, spaces, update, failure safety and uninstall", { skip: process.platform !== "darwin", timeout: 60_000 }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "submit installer's home "));
  let responseBody = fixture;
  const server = http.createServer((req, res) => {
    assert.match(req.url, /\/api\/cli\/download$/);
    res.end(responseBody);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { HOME: home, ZDOTDIR: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/zsh", TMPDIR: os.tmpdir() };
  const install = (...args) => run("/bin/bash", ["-s", "--", ...args], env, installer);
  const command = path.join(home, ".local/bin/submit");
  const printCommand = path.join(home, ".local/bin/printfile");
  const defaults = path.join(home, ".local/share/novajudge-submit/submit-defaults.json");
  try {
    await writeFile(path.join(home, ".profile"), "# existing profile\nexport KEEP_ME=yes\n");
    const installed = await install("--url", url);
    assert.equal(installed.code, 0, installed.stderr);
    assert.deepEqual(JSON.parse(await readFile(defaults)), { baseUrl: url });
    assert.equal((await stat(command)).mode & 0o777, 0o755);
    assert.match((await run(command, ["--help"], env)).stdout, /native submit fixture/);
    assert.equal((await stat(printCommand)).mode & 0o777, 0o755);
    const printed = await run("/bin/zsh", ["-lc", 'printfile "source file.cpp" y'], env);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /arg:<printfile>\narg:<source file.cpp>\narg:<y>/);
    // A fresh zsh finds the command with only stock macOS tools in PATH.
    const login = await run("/bin/zsh", ["-lc", "submit --help"], env);
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stdout, /native submit fixture/);
    const interactive = await run("/bin/zsh", ["-ic", "submit --help"], env);
    assert.equal(interactive.code, 0, interactive.stderr);
    const bashLogin = await run("/bin/bash", ["-lc", "submit --help"], env);
    assert.equal(bashLogin.code, 0, bashLogin.stderr);
    assert.match(await readFile(path.join(home, ".profile"), "utf8"), /export KEEP_ME=yes/);
    await assert.rejects(stat(path.join(home, ".bash_profile")), { code: "ENOENT" });

    // Older submit installations have no printfile wrapper; upgrade adds it.
    await rm(printCommand);
    const reinstalled = await install("--url", `${url}/alternate/`);
    assert.equal(reinstalled.code, 0, reinstalled.stderr);
    assert.equal(JSON.parse(await readFile(defaults)).baseUrl, `${url}/alternate`);
    assert.equal((await stat(printCommand)).mode & 0o777, 0o755);
    assert.equal((await readFile(path.join(home, ".zshrc"), "utf8")).split("# >>> NovaJudge submit >>>").length, 2);

    // Reject malformed blocks before modifying any profile or installed file.
    const profilePath = path.join(home, ".profile");
    const profile = await readFile(profilePath, "utf8");
    const start = "# >>> NovaJudge submit >>>\n";
    const end = "# <<< NovaJudge submit <<<\n";
    for (const malformed of [
      profile + start + "export KEEP_AFTER_BROKEN_BLOCK=yes\n",
      end + profile,
      start + profile + end,
      profile.replace(end, ""),
    ]) {
      await writeFile(profilePath, malformed);
      const before = await snapshotTree(home);
      for (const args of [["--url", url], ["--uninstall"]]) {
        const rejected = await install(...args);
        assert.notEqual(rejected.code, 0);
        assert.match(rejected.stderr, /Malformed NovaJudge PATH block/);
        assert.deepEqual(await snapshotTree(home), before);
      }
    }
    await writeFile(profilePath, profile);

    responseBody = "<html>not the client</html>";
    const failed = await install("--url", url);
    assert.notEqual(failed.code, 0);
    assert.equal(JSON.parse(await readFile(defaults)).baseUrl, `${url}/alternate`);
    assert.equal((await run(command, ["--help"], env)).code, 0);

    const config = path.join(home, ".novajudge-submit.json");
    await writeFile(config, '{"token":"fixture-only"}\n');
    // A new higher-priority login profile must not hide the old PATH block.
    const newBashProfile = "# added after submit installation\nexport KEEP_NEW_PROFILE=yes\n";
    await writeFile(path.join(home, ".bash_profile"), newBashProfile);
    const removed = await install("--uninstall");
    assert.equal(removed.code, 0, removed.stderr);
    await assert.rejects(stat(command), { code: "ENOENT" });
    await assert.rejects(stat(printCommand), { code: "ENOENT" });
    assert.match(await readFile(config, "utf8"), /fixture-only/);
    assert.doesNotMatch(await readFile(path.join(home, ".zshrc"), "utf8"), /NovaJudge/);
    assert.match(await readFile(path.join(home, ".profile"), "utf8"), /export KEEP_ME=yes/);
    assert.doesNotMatch(await readFile(path.join(home, ".profile"), "utf8"), /NovaJudge/);
    assert.equal(await readFile(path.join(home, ".bash_profile"), "utf8"), newBashProfile);
    assert.equal((await install("--uninstall")).code, 0);

    await mkdir(path.dirname(command), { recursive: true });
    responseBody = fixture;
    await writeFile(printCommand, "unrelated print command");
    assert.notEqual((await install("--url", url)).code, 0);
    assert.notEqual((await install("--uninstall")).code, 0);
    assert.equal(await readFile(printCommand, "utf8"), "unrelated print command");
    await rm(printCommand);
    await writeFile(command, "unrelated command");
    assert.notEqual((await install("--url", url)).code, 0);
    assert.equal(await readFile(command, "utf8"), "unrelated command");
    assert.notEqual((await install("--uninstall")).code, 0);
    assert.equal(await readFile(command, "utf8"), "unrelated command");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test("bundled offline installation needs no download and preserves device credentials", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "submit offline home "));
  const env = { HOME: home, ZDOTDIR: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/zsh", TMPDIR: os.tmpdir() };
  const source = path.join(home, "bundled submit");
  const config = path.join(home, ".novajudge-submit.json");
  const credentials = '{"loginSource":"PROCTORING","token":"test-only"}\n';
  try {
    await writeFile(source, fixture);
    await writeFile(config, credentials, { mode: 0o600 });
    // This origin is deliberately unreachable: --source must not download.
    const installed = await run("/bin/bash", ["-s", "--", "--url", "http://127.0.0.1:1", "--source", source], env, installer);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stdout, /Installing bundled submit/);
    assert.equal(await readFile(config, "utf8"), credentials);
    assert.equal((await stat(config)).mode & 0o777, 0o600);
    const login = await run("/bin/zsh", ["-lc", "submit --help"], env);
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stdout, /native submit fixture/);
    const printed = await run("/bin/zsh", ["-lc", 'printfile "source file.cpp" n'], env);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /arg:<printfile>\narg:<source file.cpp>\narg:<n>/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
