#!/usr/bin/env node
/** Sequential, dependency-free integration checks against an explicitly selected go-judge. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIB = 1024 * 1024;
const ORIGINAL_LIMITS = { cpuLimit: 10_000_000_000, memoryLimit: 1024 * MIB };
const FIXTURES = new URL("../tests/fixtures/cpp23/", import.meta.url);
const JAVA_HOME = "/usr/lib/jvm/java-21-openjdk-amd64";
const ENV = [
  `PATH=/usr/bin:/bin:${JAVA_HOME}/bin`,
  "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8", `JAVA_HOME=${JAVA_HOME}`,
];
const CASES = [
  { id: "bits", file: "bits-minimal.cpp", language: "cpp", samples: [{ input: "", output: "bits-ok\n" }] },
  { id: "globals", file: "global-vectors.cpp", language: "cpp", samples: [{ input: "", output: "200010 0\n" }] },
  {
    id: "tree", file: "tree-dp.cpp", language: "cpp", provenance: "constructed-not-original",
    samples: [
      { input: "5\n1 2 3 4 5\n1 2\n1 3\n3 4\n3 5\n", output: "23 41\n34 94\n14 18\n21 45\n19 41\n" },
      { input: "1\n7\n", output: "0 0\n" },
    ],
  },
  { id: "stl", file: "stl.cpp", language: "cpp", samples: [{ input: "", output: "13 5 5\n" }] },
  { id: "features", file: "features.cpp", language: "cpp", cpp23Only: true, samples: [{ input: "", output: "42 7 23 9\n" }] },
  { id: "c", file: "smoke.c", language: "c", samples: [{ input: "19 23\n", output: "42\n" }] },
  { id: "java", file: "Main.java", language: "java", samples: [{ input: "19 23\n", output: "42\n" }] },
  { id: "pypy3", file: "smoke.py", language: "pypy3", samples: [{ input: "19 23\n", output: "42\n" }] },
];

function usage() {
  return `Usage: node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:15050 [options]

Use an isolated test container. No URL or environment-variable fallback is provided.
Options:
  --cases bits,globals,tree,stl,features,c,java,pypy3  (default: all)
  --standards c++17,c++23                           (default: c++17,c++23)
  --cpp /usr/bin/g++   --cc /usr/bin/gcc            compiler paths in sandbox
  --extra-flag=FLAG                                repeatable C++ compiler argument
  --no-static                                     diagnostic link comparison
  --repeat N                                      sequential repetitions (default: 1)
  --label TEXT                                    image/toolchain label in report
  --output PATH                                   also save JSON report
  --diagnostic-cpu-seconds N                       explicit non-acceptance measurement
  --diagnostic-memory-mib N                        explicit non-acceptance measurement
  --help

Compile defaults exactly match lib/judge.ts: -O2 -Wall -lm -static, 10 CPU seconds,
1 GiB, 50 processes. Only the C++ standard/compiler and explicit options vary.
Stdout is one JSON report; progress goes to stderr. Compilation and sample execution
must both return Accepted, with exact normalized stdout. Cached files are deleted.
The tree case is a complete constructed reproducer, not the original submission.
Exit: 0 all selected cases passed; 1 a case/cleanup failed; 2 invalid invocation.
Diagnostic limits are always labelled and do not constitute acceptance.\n`;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
}

function parseOptions(args) {
  const options = {
    url: "", cases: CASES.map(({ id }) => id), standards: ["c++17", "c++23"],
    cpp: "/usr/bin/g++", cc: "/usr/bin/gcc", extraFlags: [], static: true,
    repeat: 1, label: "", output: null, diagnostic: false, limits: { ...ORIGINAL_LIMITS },
  };
  for (let i = 0; i < args.length; i++) {
    const separator = args[i].indexOf("=");
    const key = separator === -1 ? args[i] : args[i].slice(0, separator);
    if (key === "--help") return { help: true };
    if (key === "--no-static") { options.static = false; continue; }
    const value = separator === -1 ? args[++i] : args[i].slice(separator + 1);
    if (value === undefined || value === "") throw new Error(`${key} requires a value`);
    switch (key) {
      case "--url": options.url = value; break;
      case "--cases": options.cases = [...new Set(value.split(","))]; break;
      case "--standards": options.standards = [...new Set(value.split(","))]; break;
      case "--cpp": options.cpp = value; break;
      case "--cc": options.cc = value; break;
      case "--extra-flag": options.extraFlags.push(value); break;
      case "--repeat": options.repeat = positiveNumber(value, key); break;
      case "--label": options.label = value; break;
      case "--output": options.output = value; break;
      case "--diagnostic-cpu-seconds":
        options.limits.cpuLimit = Math.round(positiveNumber(value, key) * 1e9);
        options.diagnostic = true;
        break;
      case "--diagnostic-memory-mib":
        options.limits.memoryLimit = Math.round(positiveNumber(value, key) * MIB);
        options.diagnostic = true;
        break;
      default: throw new Error(`Unknown option: ${key}`);
    }
  }
  if (!options.url) throw new Error("--url is required; explicitly choose an isolated go-judge instance");
  const url = new URL(options.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("--url must be an HTTP(S) URL without credentials, query, or fragment");
  }
  options.url = url.href.replace(/\/+$/, "");
  if (!Number.isSafeInteger(options.repeat)) throw new Error("--repeat must be a positive integer");
  if (!Object.values(options.limits).every(Number.isSafeInteger)) throw new Error("Diagnostic limits are too large");
  if (options.cases.some((id) => !CASES.some((test) => test.id === id))) throw new Error("Unknown case in --cases");
  if (options.standards.some((standard) => !/^(c|gnu)\+\+(17|20|23)$/.test(standard))) {
    throw new Error("Standards must be c++17/c++20/c++23 or their gnu++ equivalents");
  }
  if (options.cases.includes("features") && !options.standards.some((standard) => standard.endsWith("23"))) {
    throw new Error("The features case needs c++23 or gnu++23");
  }
  return options;
}

function fileDescriptors(input = "") {
  return [{ content: input }, { name: "stdout", max: 1_000_000 }, { name: "stderr", max: 1_000_000 }];
}

function measurements(result) {
  const cpuNs = Number.isFinite(result.time) ? result.time : null;
  const memoryBytes = Number.isFinite(result.memory) ? result.memory : null;
  return {
    status: result.status ?? "Missing status", exitStatus: result.exitStatus ?? null,
    cpuNs, cpuSeconds: cpuNs === null ? null : cpuNs / 1e9,
    memoryBytes, memoryMiB: memoryBytes === null ? null : memoryBytes / MIB,
    stdout: result.files?.stdout ?? "", stderr: result.files?.stderr ?? "",
    error: result.error ?? null,
  };
}

function normalized(text) { return text.replace(/\r\n/g, "\n").trimEnd(); }
function accepted(result) { return result.status === "Accepted" && (result.exitStatus ?? 0) === 0; }

function languageConfig(language, standard, options) {
  if (language === "cpp" || language === "c") {
    const cpp = language === "cpp";
    return {
      source: cpp ? "main.cpp" : "main.c", executable: "main", run: ["./main"],
      compile: [
        cpp ? options.cpp : options.cc, cpp ? "main.cpp" : "main.c", "-o", "main", "-O2", "-Wall", "-lm",
        ...(options.static ? ["-static"] : []), `-std=${cpp ? standard : "c11"}`,
        ...(cpp ? options.extraFlags : []),
      ],
    };
  }
  if (language === "java") return {
    source: "Main.java", executable: "Main.jar",
    compile: ["/usr/bin/bash", "-c", `export PATH=$PATH:${JAVA_HOME}/bin && ${JAVA_HOME}/bin/javac -d . -encoding utf8 ./Main.java && jar cvf Main.jar *.class >/dev/null`],
    run: [`${JAVA_HOME}/bin/java`, "-Dfile.encoding='UTF-8'", "-cp", "Main.jar", "Main"],
  };
  return { source: "main.py", executable: "main.py", compile: null, run: ["/usr/bin/pypy3", "main.py"] };
}

async function main(options) {
  const cachedIds = new Set();
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), label: options.label,
    endpoint: options.url, diagnosticOnly: options.diagnostic,
    compileLimits: options.limits, originalCompileLimits: ORIGINAL_LIMITS,
    options: { cpp: options.cpp, cc: options.cc, standards: options.standards, extraFlags: options.extraFlags, static: options.static, repeat: options.repeat },
    fixtureProvenance: "tree-dp.cpp is a constructed complete program; the original user submission was not provided",
    toolchains: {}, results: [], cleanupErrors: [],
  };
  async function runCommand(command) {
    const response = await fetch(`${options.url}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: [command] }),
      signal: AbortSignal.timeout(Math.max(60_000, Math.ceil((command.cpuLimit / 1e9) * 10_000))),
    });
    if (!response.ok) throw new Error(`go-judge /run HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
    const results = await response.json();
    if (!Array.isArray(results) || !results[0] || typeof results[0] !== "object") {
      throw new Error(`Invalid go-judge response: ${JSON.stringify(results).slice(0, 1000)}`);
    }
    for (const result of results) {
      for (const id of Object.values(result.fileIds ?? {})) if (typeof id === "string") cachedIds.add(id);
    }
    return results[0];
  }
  async function cleanFiles() {
    for (const id of cachedIds) {
      try {
        const response = await fetch(`${options.url}/file/${encodeURIComponent(id)}`, {
          method: "DELETE", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
        cachedIds.delete(id);
      } catch (error) {
        report.cleanupErrors.push({ id, error: String(error) });
      }
    }
  }

  try {
    const versionCommands = [];
    if (options.cases.some((id) => CASES.find((test) => test.id === id).language === "cpp")) versionCommands.push(["cpp", [options.cpp, "--version"]]);
    if (options.cases.includes("c")) versionCommands.push(["c", [options.cc, "--version"]]);
    if (options.cases.includes("java")) versionCommands.push(["java", [`${JAVA_HOME}/bin/java`, "-version"]]);
    if (options.cases.includes("pypy3")) versionCommands.push(["pypy3", ["/usr/bin/pypy3", "--version"]]);
    for (const [name, args] of versionCommands) {
      report.toolchains[name] = measurements(await runCommand({
        args, env: ENV, files: fileDescriptors(), ...ORIGINAL_LIMITS, procLimit: 50,
      }));
    }
    for (const test of CASES.filter(({ id }) => options.cases.includes(id))) {
      const source = await readFile(new URL(test.file, FIXTURES), "utf8");
      const standards = test.language === "cpp"
        ? options.standards.filter((standard) => !test.cpp23Only || standard.endsWith("23")) : [null];
      for (const standard of standards) {
        for (let iteration = 1; iteration <= options.repeat; iteration++) {
          const config = languageConfig(test.language, standard, options);
          const row = {
            case: test.id, fixture: test.file, sourceSha256: createHash("sha256").update(source).digest("hex"),
            standard, iteration, compileCommand: config.compile, runCommand: config.run,
            compile: null, executions: [], passed: false, withinOriginalCompileLimits: null,
          };
          report.results.push(row);
          console.error(`[${test.id}${standard ? `/${standard}` : ""}] iteration ${iteration}/${options.repeat}`);
          try {
            let executableId;
            if (config.compile) {
              const result = await runCommand({
                args: config.compile, env: ENV, files: fileDescriptors(), ...options.limits,
                procLimit: 50, copyIn: { [config.source]: { content: source } },
                copyOut: ["stdout", "stderr"], copyOutCached: [config.executable],
              });
              row.compile = measurements(result);
              row.withinOriginalCompileLimits = row.compile.cpuNs !== null && row.compile.memoryBytes !== null &&
                row.compile.cpuNs <= ORIGINAL_LIMITS.cpuLimit && row.compile.memoryBytes <= ORIGINAL_LIMITS.memoryLimit;
              if (!accepted(result)) continue;
              executableId = result.fileIds?.[config.executable];
              if (!executableId) throw new Error("Accepted compile did not return a cached executable");
            }
            for (const [index, sample] of test.samples.entries()) {
              const result = await runCommand({
                args: config.run, env: ENV, files: fileDescriptors(sample.input),
                cpuLimit: test.language === "java" ? 4_000_000_000 : 2_000_000_000,
                memoryLimit: (test.language === "java" ? 512 : 256) * MIB,
                procLimit: 50, stackLimit: 2 * 1024 * MIB,
                copyIn: { [config.executable]: executableId ? { fileId: executableId } : { content: source } },
              });
              row.executions.push({
                sample: index + 1, ...measurements(result),
                expectedStdout: sample.output, outputMatched: normalized(result.files?.stdout ?? "") === normalized(sample.output),
                passed: accepted(result) && normalized(result.files?.stdout ?? "") === normalized(sample.output),
              });
            }
            row.passed = row.executions.length === test.samples.length && row.executions.every(({ passed }) => passed);
          } catch (error) {
            row.error = String(error);
          } finally {
            await cleanFiles();
          }
        }
      }
    }
  } catch (error) {
    report.error = String(error);
  } finally {
    await cleanFiles();
    report.finishedAt = new Date().toISOString();
    report.cachedFilesRemaining = cachedIds.size;
    report.passed = !report.error && Object.values(report.toolchains).every(accepted) && report.results.length > 0 &&
      report.results.every(({ passed }) => passed) && report.cleanupErrors.length === 0;
    report.acceptancePassed = report.passed && !options.diagnostic &&
      report.results.every(({ compile, withinOriginalCompileLimits }) => !compile || withinOriginalCompileLimits);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) await writeFile(options.output, json, "utf8");
    process.stdout.write(json);
    if (!report.passed || (!options.diagnostic && !report.acceptancePassed)) process.exitCode = 1;
  }
}

// Import-safe for lightweight CLI/mock-server checks; no network call on import.
export { CASES, languageConfig, measurements, parseOptions };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else await main(options);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
