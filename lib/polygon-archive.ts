import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import yaml from "js-yaml";
import { ProblemArchiveError, type SingleProblemArchive } from "./problem-archive";
import { getPolygonJudgeConfig, normalizeJudgeDataFileName, normalizeProblemJudgeConfig } from "./problem-judge-config";
import { polygonStatement } from "./polygon-statement";

type XmlNode = Record<string, unknown>;
export type ImportFormat = "native" | "polygon";
export interface PolygonProblem {
  archive: SingleProblemArchive;
  warnings: string[];
}
interface ProblemSource {
  zip: JSZip;
  prefix: string;
  location: string;
  xml: XmlNode;
}
export interface PolygonContest {
  title: string;
  problems: (PolygonProblem & { displayId: string })[];
}

function node(value: unknown): XmlNode {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as XmlNode : {};
}
function nodes(value: unknown): XmlNode[] {
  return (value === undefined ? [] : Array.isArray(value) ? value : [value]).map(node);
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function integer(value: unknown, label: string, maximum = 2147483647): number {
  const number = Number(value);
  if (!/^\d+$/.test(text(value)) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new ProblemArchiveError(`Invalid Polygon ${label}.`);
  }
  return number;
}
export function polygonPath(value: string): string {
  try {
    return normalizeJudgeDataFileName(value);
  } catch {
    throw new ProblemArchiveError(`Invalid Polygon package path: ${value}`);
  }
}

/** Validate original ZIP paths, including names JSZip would otherwise silently sanitize. */
export async function readImportZip(buffer: ArrayBuffer | Buffer): Promise<JSZip> {
  const zip = new JSZip();
  zip.files = new Proxy(zip.files, {
    set(files, name: string, entry: JSZip.JSZipObject) {
      if (Object.hasOwn(files, name)) throw new ProblemArchiveError(`Duplicate archive path: ${name}`);
      Object.defineProperty(files, name, { value: entry, enumerable: true, configurable: true, writable: true });
      return true;
    },
  });
  try {
    await zip.loadAsync(buffer, { checkCRC32: true });
  } catch (error) {
    if (error instanceof ProblemArchiveError) throw error;
    throw new ProblemArchiveError("Invalid or damaged ZIP archive.");
  }
  const names = new Map<string, boolean>();
  const entries: [string, JSZip.JSZipObject][] = [];
  for (const entry of Object.values(zip.files)) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    const normalize = (name: string) => polygonPath(entry.dir ? name.replace(/[/\\]+$/, "") : name);
    if (original !== undefined) normalize(original);
    const name = normalize(entry.name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new ProblemArchiveError(`Duplicate archive path: ${name}`);
    names.set(key, entry.dir);
    entries.push([name, entry]);
  }
  for (const [name] of entries) {
    const parts = name.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      if (names.get(parts.slice(0, i).join("/")) === false) {
        throw new ProblemArchiveError(`Conflicting archive path: ${name}`);
      }
    }
  }
  // Normalize Windows separators too; no extraction uses raw ZIP names.
  zip.files = Object.fromEntries(entries.map(([name, entry]) => [name + (entry.dir ? "/" : ""), entry]));
  return zip;
}

export function resolveImportFormat(value: FormDataEntryValue | null, zip: JSZip): ImportFormat {
  if (value !== null && !["auto", "native", "polygon"].includes(String(value))) {
    throw new ProblemArchiveError("Unknown import format.");
  }
  if (value === "native" || value === "polygon") return value;
  const names = Object.keys(zip.files);
  if (names.some((name) => /(^|\/)(problem|contest)\.json$/.test(name))) return "native";
  return names.some((name) => /(^|\/)(problem|contest)\.xml$|\.zip$/i.test(name)) ? "polygon" : "native";
}

async function readXml(entry: JSZip.JSZipObject, root: string): Promise<XmlNode> {
  const source = await entry.async("text");
  if (source.length > 2 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)\b/i.test(source) || XMLValidator.validate(source) !== true) {
    throw new ProblemArchiveError(`${entry.name}: invalid XML (DTD and entity declarations are not supported).`);
  }
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(source);
  if (!parsed[root] || typeof parsed[root] !== "object") {
    throw new ProblemArchiveError(`${entry.name}: expected a <${root}> descriptor.`);
  }
  return node(parsed[root]);
}

function descriptors(zip: JSZip, file: string) {
  return Object.entries(zip.files).filter(([name, entry]) => !entry.dir && (name === file || name.endsWith(`/${file}`)));
}

async function problemSources(zip: JSZip): Promise<ProblemSource[]> {
  const sources: ProblemSource[] = [];
  async function collect(current: JSZip, container = "") {
    for (const [name, entry] of descriptors(current, "problem.xml")) {
      sources.push({ zip: current, prefix: name.slice(0, -"problem.xml".length), location: container || name, xml: await readXml(entry, "problem") });
    }
  }
  await collect(zip);
  const prefixes = sources.map((source) => source.prefix);
  // A contest ZIP may contain downloaded problem ZIPs. Never recurse into problem attachments.
  for (const [name, entry] of Object.entries(zip.files).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    if (entry.dir || !name.toLowerCase().endsWith(".zip") || prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const nested = await readImportZip(await entry.async("nodebuffer"));
    if (descriptors(nested, "problem.xml").length !== 1) {
      throw new ProblemArchiveError(`${name}: each nested ZIP must contain exactly one problem.xml.`);
    }
    await collect(nested, name);
  }
  if (!sources.length) throw new ProblemArchiveError("No Polygon problem.xml found. Upload complete Polygon problem packages.");
  return sources.sort((a, b) => a.location.localeCompare(b.location, "en", { numeric: true }));
}

export function languageRank(language: string): number {
  if (/^(chinese|zh(?:-cn|-hans)?)$/i.test(language)) return 0;
  if (/^(english|en)$/i.test(language)) return 1;
  return 2;
}
function titleOf(xml: XmlNode): string {
  return nodes(node(xml.names).name).sort((a, b) => languageRank(text(a["@_language"])) - languageRank(text(b["@_language"])))
    .map((name) => text(name["@_value"]).trim()).find(Boolean) || text(xml["@_short-name"]);
}

function testPath(pattern: unknown, index: number): string {
  const value = text(pattern);
  const matches = [...value.matchAll(/%(?:0?(\d{1,2}))?d/g)];
  if (matches.length !== 1 || value.replace(matches[0][0], "").includes("%") || Number(matches[0][1] || 0) > 10) {
    throw new ProblemArchiveError(`Unsupported Polygon test path pattern: ${value}`);
  }
  return polygonPath(value.replace(matches[0][0], String(index).padStart(Number(matches[0][1] || 0), "0")));
}

/** Local includes are embedded because the judge compiles one C++ source plus its own testlib.h. */
async function judgeSource(source: ProblemSource, filename: string, stack: string[] = []): Promise<string> {
  if (stack.includes(filename) || stack.length > 32) throw new ProblemArchiveError(`Circular judge include: ${filename}`);
  const entry = source.zip.file(source.prefix + filename);
  if (!entry) throw new ProblemArchiveError(`Missing Polygon judge source/header: ${filename}`);
  let code = await entry.async("text");
  const includes = [...code.matchAll(/^\s*#\s*include\s*"([^"\r\n]+)"[^\r\n]*$/gm)];
  for (const match of includes.reverse()) {
    if (match[1] === "testlib.h") continue;
    // Resolve ../ only within the problem root, for ordinary relative C++ includes.
    const relative = polygonPath(path.posix.join(path.posix.dirname(filename), match[1].replace(/\\/g, "/")));
    const dependency = await judgeSource(source, relative, [...stack, filename]);
    code = code.slice(0, match.index) + `\n${dependency}\n` + code.slice(match.index! + match[0].length);
  }
  return code;
}

async function importJudgeProgram(source: ProblemSource, asset: XmlNode, kind: "checker" | "interactor") {
  const file = node(asset.source);
  if (!text(file["@_path"])) throw new ProblemArchiveError(`Polygon ${kind} source is missing; include its C++ source in the package.`);
  if (asset["@_type"] !== undefined && asset["@_type"] !== "testlib") {
    throw new ProblemArchiveError(`Only Polygon testlib ${kind}s are supported.`);
  }
  const filename = polygonPath(text(file["@_path"]));
  if (!/\.(cpp|cc|cxx)$/i.test(filename) || (file["@_type"] !== undefined && !text(file["@_type"]).startsWith("cpp"))) {
    throw new ProblemArchiveError(`Only C++ Polygon ${kind}s are supported.`);
  }
  return Buffer.from(await judgeSource(source, filename));
}

async function parseProblem(source: ProblemSource): Promise<PolygonProblem> {
  const { xml, zip, prefix } = source;
  const title = titleOf(xml);
  if (!title.trim()) throw new ProblemArchiveError("Polygon problem has no title.");
  const judging = node(xml.judging);
  const assets = node(xml.assets);
  const interactive = assets.interactor !== undefined || text(xml["@_type"]).toLowerCase() === "interactive";
  const interactor = node(assets.interactor);
  const rawRuns = node(interactor.runs).run;
  // Polygon omits <runs> for traditional single-interactor packages.
  const interactorRuns = !interactive ? [] : interactor.runs === undefined ? [1]
    : (rawRuns === undefined ? [] : Array.isArray(rawRuns) ? rawRuns : [rawRuns]).map((run) => integer(run, "interactor run", 2));
  const runCount = integer(judging["@_run-count"] ?? "1", "run-count (only 1 or 2 supported)", 2);
  if (interactive && !interactorRuns.length) throw new ProblemArchiveError("Polygon interactor runs must include run 1.");
  const polygon = getPolygonJudgeConfig({ run_count: runCount, interactor_runs: interactorRuns })!;
  const type = runCount === 2 ? "communication" : interactive ? "interactive" : "spj";
  const usesPolygonProtocol = type !== "spj";
  if (!["", "stdin"].includes(text(judging["@_input-file"])) || !["", "stdout"].includes(text(judging["@_output-file"]))) {
    throw new ProblemArchiveError("Polygon file I/O problems are not supported. Export a standard input/output version.");
  }
  const testsets = nodes(judging.testset);
  const testset = testsets.find((item) => item["@_name"] === "tests") || (testsets.length === 1 ? testsets[0] : undefined);
  if (!testset) throw new ProblemArchiveError("Polygon judging/testset named 'tests' is missing or ambiguous.");
  const timeLimit = integer(testset["time-limit"], "time limit");
  const memoryBytes = integer(testset["memory-limit"], "memory limit", Number.MAX_SAFE_INTEGER);
  const memoryLimit = Math.ceil(memoryBytes / 1024 / 1024);
  if (memoryLimit > 2147483647) throw new ProblemArchiveError("Polygon memory limit is too large.");
  const count = integer(testset["test-count"], "test count", 10000);
  const tests = nodes(node(testset.tests).test);
  if (tests.length && tests.length !== count) throw new ProblemArchiveError("Polygon test-count does not match its test list.");
  const hasPointScores = tests.some((test) => {
    if (test["@_points"] === undefined) return false;
    const points = text(test["@_points"]);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(points)) {
      throw new ProblemArchiveError(`Invalid Polygon test points: ${points}`);
    }
    // Polygon also exports points="0.0" on ACM tests. Check the mantissa
    // rather than Number(points), which can round tiny positive scores to zero.
    return /[1-9]/.test(points.split(/[eE]/)[0]);
  });
  if (nodes(node(testset.groups).group).length || hasPointScores || judging["@_treat-points-from-checker-as-percent"] === "true") {
    throw new ProblemArchiveError("Polygon scoring groups/partial scores are not supported by this ACM/ICPC importer.");
  }
  const files = new Map<string, Buffer>();
  const cases: { input: string; output: string }[] = [];
  const samples: { input: string; output: string }[] = [];
  const sampleCases: number[] = [];
  for (let index = 1; index <= count; index++) {
    const pair: Buffer[] = [];
    for (const pattern of [testset["input-path-pattern"], testset["answer-path-pattern"] ?? testset["output-path-pattern"]]) {
      const name = testPath(pattern, index);
      const entry = zip.file(prefix + name);
      if (!entry) throw new ProblemArchiveError(`Missing Polygon test data: ${name}. Export a Linux or Windows package with all generated tests and answers.`);
      pair.push(await entry.async("nodebuffer"));
    }
    const name = String(index).padStart(3, "0");
    files.set(`data/${name}.in`, pair[0]);
    files.set(`data/${name}.out`, pair[1]);
    cases.push({ input: `${name}.in`, output: `${name}.out` });
    if (tests[index - 1]?.["@_sample"] === "true") {
      sampleCases.push(index);
      // Interactive/communication judge inputs can contain private data absent from the statement.
      if (!usesPolygonProtocol) samples.push({ input: pair[0].toString("utf8"), output: pair[1].toString("utf8") });
    }
  }
  files.set("data/checker.cpp", await importJudgeProgram(source, node(assets.checker), "checker"));
  if (interactive) files.set("data/interactor.cpp", await importJudgeProgram(source, interactor, "interactor"));
  const { config } = normalizeProblemJudgeConfig({
    type, checker: "checker.cpp", cases,
    ...(interactive ? { interactor: "interactor.cpp" } : {}),
    ...(usesPolygonProtocol ? { polygon: { ...polygon, sample_cases: sampleCases } } : {}),
  }, {
    currentType: type, files: [...files.keys()].map((name) => name.slice(5)),
  });
  files.set("data/problem.yml", Buffer.from(yaml.dump(config)));
  const warnings: string[] = [];
  const statement = await polygonStatement({
    zip, prefix, statements: nodes(node(xml.statements).statement).map((item) => ({
      path: text(item["@_path"]), type: text(item["@_type"]), language: text(item["@_language"]), charset: text(item["@_charset"]),
    })), samples, files, warnings, preserveExamples: usesPolygonProtocol,
  });
  return { archive: { data: {
    title, type, defaultTimeLimit: timeLimit, defaultMemoryLimit: memoryLimit,
    sections: statement.sections, samples: statement.samples, hint: null,
    judgeConfig: config as SingleProblemArchive["data"]["judgeConfig"],
  }, files }, warnings: warnings.map((warning) => `${title}: ${warning}`) };
}

async function checkedProblem(source: ProblemSource) {
  try { return await parseProblem(source); }
  catch (error) { throw new ProblemArchiveError(`${source.location}: ${(error as Error).message}`); }
}

export async function parsePolygonProblems(zip: JSZip): Promise<PolygonProblem[]> {
  // A Polygon contest export is also a batch problem package. Honor its declared order
  // from either upload entry point, without creating a NovaJudge contest.
  if (descriptors(zip, "contest.xml").length) return (await parsePolygonContest(zip, "Polygon")).problems;
  const result: PolygonProblem[] = [];
  for (const source of await problemSources(zip)) result.push(await checkedProblem(source));
  return result;
}

function displayId(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

export async function parsePolygonContest(zip: JSZip, filename: string): Promise<PolygonContest> {
  const sources = await problemSources(zip);
  const contests = descriptors(zip, "contest.xml");
  if (contests.length > 1) throw new ProblemArchiveError("Upload one Polygon contest at a time.");
  let title = filename.replace(/\.zip$/i, "");
  let ordered = sources.map((source, index) => ({ source, displayId: displayId(index) }));
  if (contests.length) {
    const [name, entry] = contests[0];
    const contest = await readXml(entry, "contest");
    title = titleOf(contest) || title;
    const references = nodes(node(contest.problems).problem);
    if (!references.length) throw new ProblemArchiveError("Polygon contest.xml contains no problems.");
    const prefix = name.slice(0, -"contest.xml".length);
    const used = new Set<ProblemSource>();
    const labels = new Set<string>();
    ordered = references.map((reference) => {
      const label = text(reference["@_index"]).trim().toUpperCase();
      if (!/^[A-Z0-9]+$/.test(label) || labels.has(label)) throw new ProblemArchiveError(`Invalid or duplicate Polygon contest index: ${label}`);
      labels.add(label);
      const url = text(reference["@_url"]).replace(/\/+$/, "");
      const packagePath = text(reference["@_path"]);
      const relative = packagePath ? prefix + polygonPath(packagePath.replace(/[/\\]+$/, "")) : "";
      let matches = relative ? sources.filter((source) => [source.location, source.location.replace(/\/problem\.xml$/, "")].includes(relative)) : [];
      if (!matches.length && url) matches = sources.filter((source) => text(source.xml["@_url"]).replace(/\/+$/, "") === url);
      if (!matches.length && url) matches = sources.filter((source) => text(source.xml["@_short-name"]) === url.split("/").pop());
      if (matches.length !== 1 || used.has(matches[0])) {
        throw new ProblemArchiveError(`Cannot uniquely resolve contest problem ${label}. Include its complete problem directory or ZIP alongside contest.xml.`);
      }
      used.add(matches[0]);
      return { source: matches[0], displayId: label };
    });
  }
  const problems: PolygonContest["problems"] = [];
  for (const item of ordered) problems.push({ ...await checkedProblem(item.source), displayId: item.displayId });
  return { title, problems };
}

export function polygonAssetName(name: string): string {
  return `${createHash("sha256").update(name).digest("hex").slice(0, 20)}${path.posix.extname(name).toLowerCase()}`;
}
