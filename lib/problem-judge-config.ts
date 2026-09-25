import path from "node:path";

export const PROBLEM_TYPES = ["default", "spj", "interactive", "communication"] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];
export const DEFAULT_COMMUNICATION_OUTPUT_LIMIT = 1048576;
export const MAX_COMMUNICATION_OUTPUT_LIMIT = 16777216;

export interface ProblemJudgeConfig {
  [key: string]: unknown;
  type: ProblemType;
  cases: { input: string; output: string }[];
  checker?: string;
  interactor?: string;
  communicator?: string;
  communication?: { output_limit: number; [key: string]: unknown };
}

export function isProblemType(value: unknown): value is ProblemType {
  return typeof value === "string" && PROBLEM_TYPES.includes(value as ProblemType);
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function getCommunicationOutputLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_COMMUNICATION_OUTPUT_LIMIT;
  if (!isMapping(value)) throw new Error("communication must be a YAML mapping.");
  const limit = value.output_limit === undefined ? DEFAULT_COMMUNICATION_OUTPUT_LIMIT : value.output_limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) ||
      limit < 1 || limit > MAX_COMMUNICATION_OUTPUT_LIMIT) {
    throw new Error(`communication.output_limit must be an integer from 1 to ${MAX_COMMUNICATION_OUTPUT_LIMIT} bytes.`);
  }
  return limit;
}

/** Validate portable paths before resolving them on either Windows or Linux. */
export function normalizeJudgeDataFileName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() ||
      [...value].some((char) => char.charCodeAt(0) < 32) || /[<>:"|?*]/.test(value)) {
    throw new Error("Data file paths must be non-empty relative paths.");
  }
  const name = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(name) || path.win32.isAbsolute(value)) {
    throw new Error(`Data file must be inside the problem data directory: ${value}`);
  }
  const parts = name.split("/").filter((part) => part && part !== ".");
  if (!parts.length || name.endsWith("/") || parts.some((part) => part === ".." ||
      /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Invalid relative data file path: ${value}`);
  }
  return parts.join("/");
}

/** /dev/null is a judge sentinel and must be handled by the caller. */
export function resolveJudgeDataPath(dataDir: string, fileName: string): string {
  const name = normalizeJudgeDataFileName(fileName);
  const root = path.resolve(dataDir);
  const target = path.resolve(root, ...name.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Data file must be inside the problem data directory: ${fileName}`);
  }
  return target;
}

interface NormalizeOptions {
  currentType: string;
  files: Iterable<string>;
  autoDetect?: boolean;
}

/** Require a complete judge package when saving data; creating an empty problem stays separate. */
export function normalizeProblemJudgeConfig(
  value: unknown,
  { currentType, files: inputFiles, autoDetect = false }: NormalizeOptions,
): { type: ProblemType; config: ProblemJudgeConfig } {
  if (value != null && !isMapping(value)) throw new Error("problem.yml must contain a YAML mapping.");
  const parsed = { ...(value as Record<string, unknown> | null | undefined) };
  const files = new Set(Array.from(inputFiles, normalizeJudgeDataFileName));

  function existingFile(value: unknown, label: string, allowNull = false): string {
    if (allowNull && value === "/dev/null") return "/dev/null";
    let name: string;
    try {
      name = normalizeJudgeDataFileName(value);
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
    if (!files.has(name)) throw new Error(`${label} file not found: ${name}`);
    return name;
  }

  const checker = parsed.checker !== undefined
    ? existingFile(parsed.checker, "Checker")
    : autoDetect && files.has("checker.cpp") ? "checker.cpp" : undefined;
  const interactor = parsed.interactor !== undefined
    ? existingFile(parsed.interactor, "Interactor")
    : autoDetect && files.has("interactor.cpp") ? "interactor.cpp" : undefined;
  const communicator = parsed.communicator !== undefined
    ? existingFile(parsed.communicator, "Communicator")
    : autoDetect && files.has("communicator.cpp") ? "communicator.cpp" : undefined;

  // Existing communication/interactive problems never silently downgrade when their program is missing.
  const selectedType = parsed.type !== undefined ? parsed.type
    : communicator ? "communication"
    : currentType === "communication" ? currentType
    : interactor ? "interactive"
    : currentType === "interactive" ? currentType
    : checker ? "spj" : currentType;
  if (!isProblemType(selectedType)) {
    throw new Error("Problem type must be default, spj, interactive, or communication.");
  }
  if (selectedType === "communication" && !communicator) {
    throw new Error("Communication problems require an existing communicator file.");
  }
  if (selectedType === "interactive" && !interactor) {
    throw new Error("Interactive problems require an existing interactor file.");
  }
  if (selectedType === "spj" && !checker) {
    throw new Error("Special judge problems require an existing checker file.");
  }

  let rawCases = parsed.cases;
  if (rawCases === undefined && autoDetect) {
    rawCases = [...files].filter((name) => name.endsWith(".in"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((input) => {
        const base = input.slice(0, -3);
        const output = files.has(`${base}.out`) ? `${base}.out`
          : files.has(`${base}.ans`) ? `${base}.ans` : "/dev/null";
        return { input, output };
      });
  }
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error("Configure at least one test case before saving judge data.");
  }
  const cases = rawCases.map((item: unknown, index: number) => {
    if (!isMapping(item)) throw new Error(`Test case ${index + 1} must contain an input file.`);
    return {
      input: existingFile(item.input, `Test case ${index + 1} input`, true),
      output: existingFile(item.output === undefined ? "/dev/null" : item.output,
        `Test case ${index + 1} output`, true),
    };
  });

  const config: ProblemJudgeConfig = { ...parsed, type: selectedType, cases };
  if (checker && (parsed.checker !== undefined || selectedType === "spj")) config.checker = checker;
  if (interactor && (parsed.interactor !== undefined || selectedType === "interactive")) config.interactor = interactor;
  if (communicator && (parsed.communicator !== undefined || selectedType === "communication")) config.communicator = communicator;
  if (selectedType === "communication" || parsed.communication !== undefined) {
    config.communication = {
      ...(isMapping(parsed.communication) ? parsed.communication : {}),
      output_limit: getCommunicationOutputLimit(parsed.communication),
    };
  }
  return { type: selectedType, config };
}
