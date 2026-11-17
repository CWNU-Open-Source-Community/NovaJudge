import { promises as fs } from "fs";
import path from "path";

export type EnvSettingDefinition = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  restartRequired: boolean;
};

export const ENV_SETTING_DEFINITIONS: EnvSettingDefinition[] = [
  {
    key: "DATABASE_URL",
    label: "Database URL",
    description: "PostgreSQL connection string used by Prisma.",
    placeholder: "postgresql://postgres:password@localhost:5432/xcpc_oj?schema=public",
    restartRequired: true,
  },
  {
    key: "REDIS_URL",
    label: "Redis URL",
    description: "Redis connection string used by queues, cache, and realtime state.",
    placeholder: "redis://localhost:6379",
    restartRequired: true,
  },
  {
    key: "GO_JUDGE_API",
    label: "Go Judge API",
    description: "Base URL for the go-judge service.",
    placeholder: "http://localhost:5050",
    restartRequired: true,
  },
  {
    key: "EXTERNAL_AUTH_URL",
    label: "External Login URL",
    description: "Password-login endpoint for the external identity provider.",
    placeholder: "https://example.com/api/user/external/login",
    restartRequired: false,
  },
  {
    key: "NOVAJUDGE_URL",
    label: "NovaJudge URL",
    description: "Public base URL used by CLI tools and auto-login helpers.",
    placeholder: "http://localhost:3001",
    restartRequired: false,
  },
];

const ALLOWED_KEYS = new Set(ENV_SETTING_DEFINITIONS.map((item) => item.key));
const ENV_PATH = path.join(process.cwd(), ".env");

function parseEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  return trimmed;
}

function formatEnvValue(value: string) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

  return `"${escaped}"`;
}

async function readEnvFile() {
  try {
    return await fs.readFile(ENV_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function getManagedEnvSettings() {
  const content = await readEnvFile();
  const values = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (ALLOWED_KEYS.has(key)) {
      values.set(key, parseEnvValue(rawValue));
    }
  }

  return ENV_SETTING_DEFINITIONS.map((definition) => ({
    ...definition,
    value: values.get(definition.key) ?? process.env[definition.key] ?? "",
  }));
}

export async function updateManagedEnvSettings(updates: Record<string, string>) {
  const normalizedUpdates = Object.fromEntries(
    Object.entries(updates)
      .filter(([key]) => ALLOWED_KEYS.has(key))
      .map(([key, value]) => [key, String(value ?? "").trim()]),
  );

  const lines = (await readEnvFile()).split(/\r?\n/);
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match) return line;

    const [, leading, key, separator] = match;
    if (!(key in normalizedUpdates)) return line;

    seen.add(key);
    return `${leading}${key}${separator}${formatEnvValue(normalizedUpdates[key])}`;
  });

  const missingEntries = Object.entries(normalizedUpdates).filter(
    ([key]) => !seen.has(key),
  );

  if (missingEntries.length > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push("# Managed from admin settings");
    for (const [key, value] of missingEntries) {
      nextLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  await fs.writeFile(ENV_PATH, nextLines.join("\n"), "utf8");

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    process.env[key] = value;
  }

  return getManagedEnvSettings();
}
