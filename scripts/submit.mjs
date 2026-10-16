#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const CONFIG_PATH = path.join(os.homedir(), ".novajudge-submit.json");
const DESKTOP_CREDENTIAL_PATH = path.join(
  os.homedir(),
  "Desktop",
  "novajudge-submit.json",
);
const DEFAULT_BASE_URL = process.env.NOVAJUDGE_URL || "http://localhost:3001";

const EXT_LANGUAGE = new Map([
  [".c", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".cxx", "cpp"],
  [".java", "java"],
  [".py", "pypy3"],
  [".py3", "pypy3"],
]);

function usage() {
  console.log(`Usage:
  submit login --url http://localhost:3001 --contest 1001 --user team001
  submit A.cpp
  submit --problem A main.cpp
  submit status

Desktop credential file:
  ${DESKTOP_CREDENTIAL_PATH}
  {
    "url": "http://localhost:3001",
    "contestId": 1001,
    "username": "team001",
    "password": "team-password",
    "contestPassword": "private-contest-password"
  }

Environment:
  NOVAJUDGE_URL can override the default server URL for login.`);
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

function readDesktopCredentials() {
  if (!fs.existsSync(DESKTOP_CREDENTIAL_PATH)) return null;

  const raw = JSON.parse(fs.readFileSync(DESKTOP_CREDENTIAL_PATH, "utf8"));
  const username = String(raw.username || raw.user || "").trim();
  const password = String(raw.password || "").trim();
  const contestPassword = String(raw.contestPassword || "");
  const baseUrl = String(raw.url || raw.baseUrl || DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const contestId =
    raw.contestId === undefined || raw.contestId === null
      ? null
      : Number(raw.contestId);

  if (!username || !password) {
    throw new Error(
      `Desktop credential file must contain username and password: ${DESKTOP_CREDENTIAL_PATH}`,
    );
  }

  if (contestId !== null && !Number.isInteger(contestId)) {
    throw new Error("contestId in desktop credential file must be an integer");
  }

  return { baseUrl, contestId, username, password, contestPassword };
}

function parseFlags(args) {
  const flags = {};
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const value = args[i + 1]?.startsWith("--") ? true : args[i + 1];
    flags[key] = value ?? true;
    if (value !== true) i += 1;
  }

  return { flags, rest };
}

function inferProblem(filePath) {
  const name = path.basename(filePath, path.extname(filePath));
  const match = name.match(/^([A-Za-z][A-Za-z0-9_-]*)/);
  return match?.[1]?.toUpperCase() || "";
}

function inferLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_LANGUAGE.get(ext) || "";
}

async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || res.statusText };
  }
}

async function requestLogin({ baseUrl, contestId, username, password, contestPassword }) {
  const res = await fetch(`${baseUrl}/api/cli/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, contestId, contestPassword }),
  });
  const data = await readJsonResponse(res);

  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.code = data.code;
    throw error;
  }

  writeConfig({
    baseUrl,
    token: data.token,
    contestAccessToken: data.contestAccessToken,
    username: data.user.username,
    teamName: data.user.displayName || data.user.username,
    contestId: data.user.contestId,
    contestTitle: data.contest.title,
  });

  return data;
}

async function loginFromDesktopCredentials() {
  const credentials = readDesktopCredentials();
  if (!credentials) return null;

  const data = await requestLogin(credentials);
  console.log(
    `Auto logged in as ${data.user.username} for contest #${data.user.contestId} ${data.contest.title}`,
  );
  return readConfig();
}

async function login(args) {
  const { flags } = parseFlags(args);
  const rl = readline.createInterface({ input, output });

  const baseUrl = String(flags.url || DEFAULT_BASE_URL).replace(/\/$/, "");
  const contestId = flags.contest ? Number(flags.contest) : null;
  const username = flags.user
    ? String(flags.user)
    : await rl.question("Username: ");
  const password = await rl.question("Password: ");
  let contestPassword = flags["contest-password"]
    ? String(flags["contest-password"])
    : undefined;

  let data;
  try {
    try {
      data = await requestLogin({ baseUrl, contestId, username, password, contestPassword });
    } catch (error) {
      if (error.code !== "CONTEST_PASSWORD_REQUIRED") throw error;
      contestPassword = await rl.question("Contest password: ");
      data = await requestLogin({ baseUrl, contestId, username, password, contestPassword });
    }
  } catch (error) {
    console.error(
      `Login failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  } finally {
    rl.close();
  }

  console.log(
    `Logged in as ${data.user.username} for contest #${data.user.contestId} ${data.contest.title}`,
  );
}

async function postSubmission(config, { problem, language, code }) {
  const res = await fetch(`${config.baseUrl}/api/cli/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "x-contest-access-token": config.contestAccessToken || "",
    },
    body: JSON.stringify({
      contestId: config.contestId,
      problem,
      language,
      code,
    }),
  });
  const data = await readJsonResponse(res);
  return { res, data };
}

async function submit(args) {
  let config = readConfig();
  const { flags, rest } = parseFlags(args);
  const filePath = rest[0];

  if (!config.token || !config.baseUrl || !config.contestId) {
    try {
      config = await loginFromDesktopCredentials();
    } catch (error) {
      console.error(
        `Auto login failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    }

    if (!config) {
      console.error(
        "Not logged in. Run: submit login --contest <id> --user <username>, or put novajudge-submit.json on Desktop.",
      );
      process.exit(1);
    }
  }

  if (!filePath) {
    usage();
    process.exit(1);
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const problem = String(flags.problem || inferProblem(filePath)).toUpperCase();
  const language = String(flags.language || inferLanguage(filePath));
  if (!problem) {
    console.error("Cannot infer problem id. Use: submit --problem A main.cpp");
    process.exit(1);
  }
  if (!language) {
    console.error("Cannot infer language. Use: submit --language cpp A.txt");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  let { res, data } = await postSubmission(config, { problem, language, code });

  if (res.status === 401 || data.code === "CONTEST_PASSWORD_REQUIRED") {
    const refreshedConfig = await loginFromDesktopCredentials();
    if (refreshedConfig) {
      config = refreshedConfig;
      ({ res, data } = await postSubmission(config, {
        problem,
        language,
        code,
      }));
    }
  }

  if (!res.ok) {
    console.error(`Submit failed: ${data.error || res.statusText}`);
    process.exit(1);
  }

  console.log(
    `Submitted #${data.submission.displayId} ${problem} ${language}: ${data.submission.id}`,
  );
  console.log(`${config.baseUrl}${data.statusUrl}`);
}

function status() {
  const config = readConfig();
  if (!config.token) {
    console.log("Not logged in.");
    return;
  }
  console.log(`User: ${config.username}`);
  console.log(`Contest: #${config.contestId} ${config.contestTitle}`);
  console.log(`Server: ${config.baseUrl}`);
}

const [commandOrFile, ...rest] = process.argv.slice(2);

if (!commandOrFile || commandOrFile === "-h" || commandOrFile === "--help") {
  usage();
} else if (commandOrFile === "login") {
  await login(rest);
} else if (commandOrFile === "status") {
  status();
} else {
  await submit([commandOrFile, ...rest]);
}
