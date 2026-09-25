import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import path from "path";
import { promises as fs } from "fs";
import { Verdict } from "@/lib/generated/prisma/enums";
import { resolveJudgeDataPath } from "@/lib/problem-judge-config";
import { runCommunicationCase, type CommunicationTrace } from "./judge/communication";
import type { ProblemSample } from "./problem-samples";

const GO_JUDGE_URL = process.env.GO_JUDGE_API || "http://localhost:5050";
const STACK_SIZE_KB = Number(process.env.JUDGE_STACK_KB || 2097152);

interface LanguageConfig {
  srcName: string;
  exeName: string;
  compileCmd?: string[];
  runCmd: string[];
}

interface LanguageJudgeConfig {
  java?: number;
  pypy3?: number;
  c?: number;
  cpp?: number;
}

interface TestCaseConfig {
  input: string;
  output?: string;
}

interface JudgeConfig {
  cases?: TestCaseConfig[];
  checker?: string;
  interactor?: string;
  communicator?: string;
  communication?: { output_limit?: number };
  time_limit_rate?: LanguageJudgeConfig;
  memory_limit_rate?: LanguageJudgeConfig;
}

interface JudgeProgress {
  verdict: string;
  passedTests: number;
  totalTests: number;
  finished: boolean;
}

type SampleData = ProblemSample;

interface ProblemForDebug {
  id: number;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  judgeConfig: unknown;
  samples: SampleData[];
}

export type SampleDebugVerdict =
  | "AC"
  | "WA"
  | "PE"
  | "TLE"
  | "MLE"
  | "RE"
  | "CE"
  | "SE";

export interface SampleDebugResult {
  sampleIndex: number;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  verdict: SampleDebugVerdict;
  timeUsedMs?: number;
  memoryUsedKb?: number;
  message?: string;
  communication?: CommunicationTrace;
}

export interface DebugAllSamplesResult {
  compile: {
    ok: boolean;
    message?: string;
  };
  results: SampleDebugResult[];
  summary: {
    total: number;
    passed: number;
  };
  message?: string;
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  c: {
    srcName: "main.c",
    exeName: "main",
    compileCmd: [
      "/usr/bin/gcc",
      "main.c",
      "-o",
      "main",
      "-O2",
      "-Wall",
      "-lm",
      "-static",
      "-std=c11",
    ],
    runCmd: ["./main"],
  },
  cpp: {
    srcName: "main.cpp",
    exeName: "main",
    compileCmd: [
      "/usr/bin/g++",
      "main.cpp",
      "-o",
      "main",
      "-O2",
      "-Wall",
      "-lm",
      "-static",
      "-std=c++23",
    ],
    runCmd: ["./main"],
  },
  java: {
    srcName: "Main.java",
    exeName: "Main.jar",
    compileCmd: [
      "/usr/bin/bash",
      "-c",
      "export PATH=$PATH:/usr/lib/jvm/java-21-openjdk-amd64/bin && /usr/lib/jvm/java-21-openjdk-amd64/bin/javac -d . -encoding utf8 ./Main.java && jar cvf Main.jar *.class >/dev/null",
    ],
    runCmd: [
      "/usr/lib/jvm/java-21-openjdk-amd64/bin/java",
      "-Dfile.encoding='UTF-8'",
      "-cp",
      "Main.jar",
      "Main",
    ],
  },
  pypy3: {
    srcName: "main.py",
    exeName: "main.py",
    runCmd: ["/usr/bin/pypy3", "main.py"],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callGoJudge(payload: any, timeoutMs?: number) {
  const res = await fetch(`${GO_JUDGE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) throw new Error(`Judge Server Error: ${res.statusText}`);
  return res.json();
}

async function deleteTmpFile(id: string) {
  try {
    const res = await fetch(`${GO_JUDGE_URL}/file/${id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`Failed to delete file ${id}: ${res.statusText}`);
    return res;
  } catch (e) {
    console.warn(`Failed to delete file ${id}`, e);
  }
}

function cleanOutput(str: string) {
  if (!str) return "";
  return str
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function getProblemDataDir(problemId: number) {
  return path.join(
    process.cwd(),
    "uploads",
    "problems",
    problemId.toString(),
    "data",
  );
}

async function updateProgress(submissionId: string, data: JudgeProgress) {
  const key = `submission:${submissionId}:progress`;
  await redis.set(key, JSON.stringify(data), "EX", 3600);
}

function getLanguageLimits(
  problem: Pick<
    ProblemForDebug,
    "defaultTimeLimit" | "defaultMemoryLimit" | "judgeConfig"
  >,
  language: string,
) {
  const judgeConfig = problem.judgeConfig as JudgeConfig | null;
  let timeLimitRate =
    judgeConfig?.time_limit_rate?.[language as keyof LanguageJudgeConfig] || 1;
  let memoryLimitRate =
    judgeConfig?.memory_limit_rate?.[language as keyof LanguageJudgeConfig] || 1;

  if (language === "java") {
    timeLimitRate *= 2;
    memoryLimitRate *= 2;
  }

  return {
    timeLimit: problem.defaultTimeLimit * 1000000 * timeLimitRate,
    memoryLimit: problem.defaultMemoryLimit * 1024 * 1024 * memoryLimitRate,
  };
}

async function compileChecker(dataDir: string, checkerName: string, binaryName = "checker") {
  const checkerPath = resolveJudgeDataPath(dataDir, checkerName);
  let checkerCode = "";
  try {
    checkerCode = await fs.readFile(checkerPath, "utf-8");
  } catch (e) {
    console.log(e);
    throw new Error(`${binaryName} file not found: ${checkerName}`);
  }

  const testlibPath = path.join(process.cwd(), "lib", "judge", "testlib.h");
  let testlibCode = "";
  try {
    testlibCode = await fs.readFile(testlibPath, "utf-8");
  } catch (e) {
    console.error("Missing testlib.h", e);
    throw new Error("System Error: testlib.h not found on server.");
  }

  const compileRes = await callGoJudge({
    cmd: [
      {
        args: [
          "/usr/bin/g++",
          `${binaryName}.cpp`,
          "-o",
          binaryName,
          "-O2",
          "-std=c++23",
        ],
        env: ["PATH=/usr/bin:/bin"],
        files: [
          { content: "" },
          { name: "stdout", max: 1000000 },
          { name: "stderr", max: 1000000 },
        ],
        cpuLimit: 10000000000,
        clockLimit: 30000000000,
        memoryLimit: 1024 * 1024 * 1024,
        procLimit: 50,
        copyIn: {
          [`${binaryName}.cpp`]: { content: checkerCode },
          "testlib.h": { content: testlibCode },
        },
        copyOut: ["stdout", "stderr"],
        copyOutCached: [binaryName],
      },
    ],
  });

  if (compileRes[0].status !== "Accepted") {
    const fe = Array.isArray(compileRes[0].fileError)
      ? compileRes[0].fileError
          .map((x: { message?: string }) => x.message)
          .filter(Boolean)
          .join("; ")
      : "";
    const stderr = compileRes[0].files?.stderr || "";
    const stdout = compileRes[0].files?.stdout || "";
    const msg = stderr || fe || stdout || `${binaryName} compile failed`;
    throw new Error(msg);
  }

  const fileId = compileRes[0].fileIds?.[binaryName];
  if (!fileId) throw new Error(`${binaryName} compilation produced no executable.`);
  return fileId as string;
}

async function compileInteractor(dataDir: string, interactorName: string) {
  const interactorPath = path.join(dataDir, interactorName);

  let interactorCode = "";
  try {
    interactorCode = await fs.readFile(interactorPath, "utf-8");
  } catch (e) {
    console.log(e);
    throw new Error(`Interactor file not found: ${interactorName}`);
  }

  const testlibPath = path.join(process.cwd(), "lib", "judge", "testlib.h");
  let testlibCode = "";
  try {
    testlibCode = await fs.readFile(testlibPath, "utf-8");
  } catch (e) {
    console.log(e);
    throw new Error("System Error: testlib.h not found on server.");
  }

  const compileRes = await callGoJudge({
    cmd: [
      {
        args: [
          "/usr/bin/g++",
          "interactor.cpp",
          "-o",
          "interactor",
          "-O2",
          "-std=c++23",
        ],
        env: ["PATH=/usr/bin:/bin"],
        files: [
          { content: "" },
          { name: "stdout", max: 1000000 },
          { name: "stderr", max: 1000000 },
        ],
        cpuLimit: 10000000000,
        memoryLimit: 1024 * 1024 * 1024,
        procLimit: 50,
        copyIn: {
          "interactor.cpp": { content: interactorCode },
          "testlib.h": { content: testlibCode },
        },
        copyOut: ["stdout", "stderr"],
        copyOutCached: ["interactor"],
      },
    ],
  });

  if (compileRes[0].status !== "Accepted") {
    const fe = Array.isArray(compileRes[0].fileError)
      ? compileRes[0].fileError
          .map((x: { message?: string }) => x.message)
          .filter(Boolean)
          .join("; ")
      : "";
    const stderr = compileRes[0].files?.stderr || "";
    const stdout = compileRes[0].files?.stdout || "";
    const msg = stderr || fe || stdout || "Interactor compile failed";
    throw new Error(msg);
  }

  return compileRes[0].fileIds["interactor"];
}

async function compileUserCode(language: string, code: string) {
  const langConfig = LANGUAGES[language];
  if (!langConfig) {
    throw new Error(`Unsupported Language: ${language}`);
  }

  if (!langConfig.compileCmd) {
    return {
      ok: true as const,
      langConfig,
      executableFileId: "",
    };
  }

  const compileRes = await callGoJudge({
    cmd: [
      {
        args: langConfig.compileCmd,
        env: [
          "PATH=/usr/bin:/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin",
          "LANG=en_US.UTF-8",
          "LC_ALL=en_US.UTF-8",
          "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
        ],
        files: [
          { content: "" },
          { name: "stdout", max: 1000000 },
          { name: "stderr", max: 1000000 },
        ],
        cpuLimit: 10000000000,
        memoryLimit: 1024 * 1024 * 1024,
        procLimit: 50,
        copyIn: {
          [langConfig.srcName]: { content: code },
        },
        copyOut: ["stdout", "stderr"],
        copyOutCached: [langConfig.exeName],
      },
    ],
  });

  const result = compileRes[0];
  if (result.status !== "Accepted") {
    return {
      ok: false as const,
      langConfig,
      message: result.files?.stderr || result.files?.stdout || "Compilation Failed",
    };
  }

  return {
    ok: true as const,
    langConfig,
    executableFileId: result.fileIds?.[langConfig.exeName] || "",
  };
}

function buildProgramCopyIn(params: {
  executableFileId?: string;
  langConfig: LanguageConfig;
  code: string;
}) {
  const { executableFileId, langConfig, code } = params;
  if (executableFileId) {
    return {
      [langConfig.exeName]: { fileId: executableFileId },
    };
  }

  return {
    [langConfig.srcName]: { content: code },
  };
}

function mapRunStatusToDebugVerdict(status: string): SampleDebugVerdict {
  if (status === "Time Limit Exceeded") return "TLE";
  if (status === "Memory Limit Exceeded") return "MLE";
  if (status === "Accepted") return "AC";
  return "RE";
}

async function loadJudgeTestCases(problem: {
  id: number;
  type: string;
  judgeConfig: unknown;
}) {
  const judgeConfig = problem.judgeConfig as JudgeConfig;
  if (!judgeConfig || !judgeConfig.cases || judgeConfig.cases.length === 0) {
    throw new Error("No judge configuration or test cases found.");
  }

  const dataDir = getProblemDataDir(problem.id);
  const testCases: { in: string; out: string }[] = [];

  for (const caseItem of judgeConfig.cases) {
    try {
      let inputContent = "";
      if (caseItem.input === "/dev/null") {
        inputContent = "";
      } else {
        inputContent = await fs.readFile(resolveJudgeDataPath(dataDir, caseItem.input), "utf-8");
      }

      let outputContent = "";
      if (caseItem.output === "/dev/null" || (problem.type === "communication" && !caseItem.output)) {
        outputContent = "";
      } else {
        if (!caseItem.output) throw new Error("Test case output is required.");
        outputContent = await fs.readFile(resolveJudgeDataPath(dataDir, caseItem.output), "utf-8");
      }

      testCases.push({
        in: inputContent,
        out: outputContent,
      });
    } catch (err) {
      console.error(
        `Error reading test case files: ${caseItem.input} / ${caseItem.output}`,
        err,
      );
      throw new Error(
        `Missing data files: ${caseItem.input} or ${caseItem.output}. Make sure they exist or use /dev/null.`,
      );
    }
  }

  return testCases;
}

async function runNonInteractiveSample(params: {
  problem: ProblemForDebug;
  language: string;
  code: string;
  sample: SampleData;
  sampleIndex: number;
  langConfig: LanguageConfig;
  executableFileId?: string;
  checkerFileId?: string;
}) {
  const {
    problem,
    language,
    code,
    sample,
    sampleIndex,
    langConfig,
    executableFileId,
    checkerFileId,
  } = params;
  const { timeLimit, memoryLimit } = getLanguageLimits(problem, language);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmdObj: any = {
    args: langConfig.runCmd,
    env: [
      "PATH=/usr/bin:/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin",
      "LANG=en_US.UTF-8",
      "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
    ],
    files: [
      { content: sample.input },
      { name: "stdout", max: 10485760 },
      { name: "stderr", max: 10485760 },
    ],
    cpuLimit: timeLimit,
    memoryLimit: memoryLimit,
    procLimit: 50,
    stackLimit: STACK_SIZE_KB * 1024,
    copyIn: buildProgramCopyIn({ executableFileId, langConfig, code }),
  };

  const runResults = await callGoJudge({ cmd: [cmdObj] });
  const runResult = runResults[0];
  const actualOutput = runResult.files?.stdout || "";
  const timeUsedMs = Number.isFinite(runResult.time)
    ? Math.floor(runResult.time / 1000000)
    : undefined;
  const memoryUsedKb = Number.isFinite(runResult.memory)
    ? Math.floor(runResult.memory / 1024)
    : undefined;

  if (runResult.status !== "Accepted") {
    return {
      sampleIndex,
      input: sample.input,
      expectedOutput: sample.output,
      actualOutput,
      verdict: mapRunStatusToDebugVerdict(runResult.status),
      timeUsedMs,
      memoryUsedKb,
      message: runResult.files?.stderr || runResult.status,
    } satisfies SampleDebugResult;
  }

  if (problem.type === "spj") {
    if (!checkerFileId) {
      return {
        sampleIndex,
        input: sample.input,
        expectedOutput: sample.output,
        actualOutput,
        verdict: "SE",
        timeUsedMs,
        memoryUsedKb,
        message: "Checker is not available.",
      } satisfies SampleDebugResult;
    }

    const checkerRes = await callGoJudge({
      cmd: [
        {
          args: ["./checker", "input.in", "user.out", "answer.out"],
          env: ["PATH=/usr/bin:/bin"],
          files: [
            { content: "", name: "stdout", max: 10485760 },
            { content: "", name: "stderr", max: 10485760 },
          ],
          cpuLimit: 10000 * 1000000,
          memoryLimit: 512 * 1024 * 1024,
          procLimit: 50,
          copyIn: {
            checker: { fileId: checkerFileId },
            "input.in": { content: sample.input },
            "user.out": { content: actualOutput },
            "answer.out": { content: sample.output },
          },
        },
      ],
    });

    const checkerResult = checkerRes[0];
    return {
      sampleIndex,
      input: sample.input,
      expectedOutput: sample.output,
      actualOutput,
      verdict: checkerResult.exitStatus === 0 ? "AC" : "WA",
      timeUsedMs,
      memoryUsedKb,
      message:
        checkerResult.files?.stderr || checkerResult.files?.stdout || undefined,
    } satisfies SampleDebugResult;
  }

  return {
    sampleIndex,
    input: sample.input,
    expectedOutput: sample.output,
    actualOutput,
    verdict: cleanOutput(actualOutput) === cleanOutput(sample.output) ? "AC" : "WA",
    timeUsedMs,
    memoryUsedKb,
  } satisfies SampleDebugResult;
}

async function runProblemCommunicationCase(params: {
  problem: ProblemForDebug;
  language: string;
  code: string;
  sample: SampleData;
  langConfig: LanguageConfig;
  executableFileId: string;
  communicatorFileId: string;
  captureTrace?: boolean;
}) {
  const { problem, language, code, sample, langConfig, executableFileId, communicatorFileId } = params;
  const { timeLimit, memoryLimit } = getLanguageLimits(problem, language);
  const judgeConfig = problem.judgeConfig as JudgeConfig | null;
  return runCommunicationCase({
    execute: (request) => callGoJudge(
      request,
      Math.ceil(Math.max(...request.cmd.map((cmd) => cmd.clockLimit)) / 1000000) + 60000,
    ),
    args: langConfig.runCmd,
    env: [
      "PATH=/usr/bin:/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin",
      "LANG=en_US.UTF-8",
      "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
    ],
    program: buildProgramCopyIn({ executableFileId, langConfig, code }),
    communicatorFileId,
    input: sample.input,
    // 题面的 communication 示例仅用于展示；裁判只读取独立的参考答案。
    answer: sample.output,
    timeLimit,
    memoryLimit,
    stackLimit: STACK_SIZE_KB * 1024,
    config: judgeConfig?.communication,
    captureTrace: params.captureTrace,
  });
}

export async function debugProblemSamples(
  problem: ProblemForDebug,
  code: string,
  language: string,
): Promise<DebugAllSamplesResult> {
  if (problem.type === "interactive") {
    return {
      compile: {
        ok: false,
        message: "Interactive problems are not supported in sample debugging yet.",
      },
      results: [],
      summary: {
        total: 0,
        passed: 0,
      },
    };
  }

  const samples = Array.isArray(problem.samples) ? problem.samples : [];
  if (samples.length === 0) {
    return {
      compile: { ok: true },
      results: [],
      summary: {
        total: 0,
        passed: 0,
      },
      message: "No samples available for this problem.",
    };
  }

  let executableFileId = "";
  let checkerFileId = "";
  let communicatorFileId = "";

  try {
    const compileResult = await compileUserCode(language, code);
    if (!compileResult.ok) {
      return {
        compile: {
          ok: false,
          message: compileResult.message,
        },
        results: [],
        summary: {
          total: samples.length,
          passed: 0,
        },
      };
    }

    executableFileId = compileResult.executableFileId;

    if (problem.type === "communication") {
      const judgeConfig = problem.judgeConfig as JudgeConfig | null;
      if (!judgeConfig?.communicator) throw new Error("Communication judge is not configured for this problem.");
      communicatorFileId = await compileChecker(getProblemDataDir(problem.id), judgeConfig.communicator, "communicator");
    }

    if (problem.type === "spj") {
      const judgeConfig = problem.judgeConfig as JudgeConfig | null;
      if (!judgeConfig?.checker) {
        return {
          compile: {
            ok: false,
            message: "SPJ checker is not configured for this problem.",
          },
          results: [],
          summary: {
            total: samples.length,
            passed: 0,
          },
        };
      }

      checkerFileId = await compileChecker(
        getProblemDataDir(problem.id),
        judgeConfig.checker,
      );
    }

    const results: SampleDebugResult[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (problem.type === "communication") {
        const result = await runProblemCommunicationCase({
          problem, language, code, sample: samples[i],
          langConfig: compileResult.langConfig,
          executableFileId, communicatorFileId, captureTrace: true,
        });
        const verdicts = {
          ACCEPTED: "AC", WRONG_ANSWER: "WA", PRESENTATION_ERROR: "PE",
          TIME_LIMIT_EXCEEDED: "TLE", MEMORY_LIMIT_EXCEEDED: "MLE",
          RUNTIME_ERROR: "RE", SYSTEM_ERROR: "SE",
        } as const;
        results.push({
          sampleIndex: i + 1,
          input: samples[i].input,
          expectedOutput: samples[i].output,
          actualOutput: result.actualOutput,
          verdict: verdicts[result.verdict],
          timeUsedMs: result.timeUsedMs,
          memoryUsedKb: result.memoryUsedKb,
          message: result.message,
          communication: result.communication,
        });
        continue;
      }
      results.push(
        await runNonInteractiveSample({
          problem,
          language,
          code,
          sample: samples[i],
          sampleIndex: i + 1,
          langConfig: compileResult.langConfig,
          executableFileId,
          checkerFileId,
        }),
      );
    }

    return {
      compile: { ok: true },
      results,
      summary: {
        total: results.length,
        passed: results.filter((item) => item.verdict === "AC").length,
      },
    };
  } catch (error) {
    const err = error as Error;
    return {
      compile: {
        ok: false,
        message: err.message || "Sample debugging failed.",
      },
      results: [],
      summary: {
        total: samples.length,
        passed: 0,
      },
    };
  } finally {
    await Promise.all([executableFileId, checkerFileId, communicatorFileId].filter(Boolean).map(deleteTmpFile));
  }
}

export async function judgeSubmission(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { problem: true },
  });

  if (!submission) return;

  await prisma.submission.update({
    where: { id: submissionId },
    data: { verdict: Verdict.JUDGING },
  });

  let executableFileId = "";
  let checkerFileId = "";
  let interactorFileId = "";
  let communicatorFileId = "";
  try {
    const { language, code, problem } = submission;
    const langConfig = LANGUAGES[language];
    if (!langConfig) throw new Error(`Unsupported Language: ${language}`);

    const judgeConfig = problem.judgeConfig as JudgeConfig;
    const testCases = await loadJudgeTestCases(problem);
    const dataDir = getProblemDataDir(problem.id);

    await updateProgress(submissionId, {
      verdict: Verdict.JUDGING,
      passedTests: 0,
      totalTests: testCases.length,
      finished: false,
    });

    const compileResult = await compileUserCode(language, code);
    if (!compileResult.ok) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          verdict: Verdict.COMPILE_ERROR,
          errorMessage: compileResult.message,
        },
      });
      await updateProgress(submissionId, {
        verdict: Verdict.COMPILE_ERROR,
        passedTests: 0,
        totalTests: testCases.length,
        finished: true,
      });
      return;
    }
    executableFileId = compileResult.executableFileId;

    const isSpj = problem.type === "spj";
    const isInteractive = problem.type === "interactive";
    const isCommunication = problem.type === "communication";

    if (isCommunication) {
      if (!judgeConfig.communicator) throw new Error("Communication judge is not configured for this problem.");
      communicatorFileId = await compileChecker(dataDir, judgeConfig.communicator, "communicator");
    }

    if (isSpj && judgeConfig.checker) {
      try {
        checkerFileId = await compileChecker(dataDir, judgeConfig.checker);
      } catch (e) {
        const err = e as Error;
        await prisma.submission.update({
          where: { id: submissionId },
          data: { verdict: Verdict.SYSTEM_ERROR, errorMessage: err.message },
        });
        await redis.del(`submission:${submissionId}:progress`);
        return;
      }
    } else if (isInteractive && judgeConfig.interactor) {
      try {
        interactorFileId = await compileInteractor(
          dataDir,
          judgeConfig.interactor,
        );
      } catch (e) {
        const err = e as Error;
        await prisma.submission.update({
          where: { id: submissionId },
          data: { verdict: Verdict.SYSTEM_ERROR, errorMessage: err.message },
        });
        await redis.del(`submission:${submissionId}:progress`);
        return;
      }
    }

    let finalVerdict: Verdict = Verdict.ACCEPTED;
    let maxTime = 0;
    let maxMemory = 0;
    let error = "";
    let passedCount = 0;

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const { timeLimit, memoryLimit } = getLanguageLimits(problem, language);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let res: any;

      if (isCommunication) {
        const result = await runProblemCommunicationCase({
          problem: { ...problem, samples: [] }, language, code,
          sample: { input: testCase.in, output: testCase.out },
          langConfig, executableFileId, communicatorFileId,
        });
        finalVerdict = result.verdict;
        error = result.message;
        res = { time: result.timeUsedMs * 1000000, memory: result.memoryUsedKb * 1024 };
      } else if (isInteractive) {
        const runResults = await callGoJudge({
          cmd: [
            {
              args: langConfig.runCmd,
              env: [
                "PATH=/usr/bin:/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin",
                "LANG=en_US.UTF-8",
                "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
              ],
              files: [null, null, { name: "stderr", max: 10485760 }],
              cpuLimit: timeLimit,
              memoryLimit: memoryLimit,
              procLimit: 50,
              stackLimit: STACK_SIZE_KB * 1024,
              copyIn: buildProgramCopyIn({
                executableFileId,
                langConfig,
                code,
              }),
            },
            {
              args: ["./interactor", "input.in", "output.xml"],
              env: ["PATH=/usr/bin:/bin"],
              files: [null, null, { name: "stderr", max: 10485760 }],
              cpuLimit: 10000 * 1000000,
              memoryLimit: 512 * 1024 * 1024,
              procLimit: 50,
              copyIn: {
                interactor: { fileId: interactorFileId },
                "input.in": { content: testCase.in },
              },
            },
          ],
          pipeMapping: [
            { in: { index: 0, fd: 1 }, out: { index: 1, fd: 0 } },
            { in: { index: 1, fd: 1 }, out: { index: 0, fd: 0 } },
          ],
        });

        const userRes = runResults[0];
        const interactorRes = runResults[1];
        res = userRes;

        if (userRes.status === "Time Limit Exceeded") {
          if (res.time > timeLimit) {
            finalVerdict = Verdict.TIME_LIMIT_EXCEEDED;
          } else {
            finalVerdict = Verdict.RUNTIME_ERROR;
          }
        } else if (userRes.status === "Memory Limit Exceeded") {
          if (res.memory > memoryLimit) {
            finalVerdict = Verdict.MEMORY_LIMIT_EXCEEDED;
          } else {
            finalVerdict = Verdict.RUNTIME_ERROR;
          }
        } else if (interactorRes.exitStatus !== 0) {
          finalVerdict = Verdict.WRONG_ANSWER;
          error = interactorRes.files?.stderr || "Interactive check failed";
        } else if (userRes.status !== "Accepted") {
          finalVerdict = Verdict.RUNTIME_ERROR;
          error = userRes.files?.stderr || "Runtime Error";
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cmdObj: any = {
          args: langConfig.runCmd,
          env: [
            "PATH=/usr/bin:/bin:/usr/lib/jvm/java-21-openjdk-amd64/bin",
            "LANG=en_US.UTF-8",
            "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
          ],
          files: [
            { content: testCase.in },
            { name: "stdout", max: 10485760 },
            { name: "stderr", max: 10485760 },
          ],
          cpuLimit: timeLimit,
          memoryLimit: memoryLimit,
          procLimit: 50,
          stackLimit: STACK_SIZE_KB * 1024,
          copyIn: buildProgramCopyIn({
            executableFileId,
            langConfig,
            code,
          }),
        };

        const runResults = await callGoJudge({ cmd: [cmdObj] });
        res = runResults[0];

        if (res.status !== "Accepted") {
          if (res.status === "Time Limit Exceeded") {
            finalVerdict = Verdict.TIME_LIMIT_EXCEEDED;
          } else if (res.status === "Memory Limit Exceeded") {
            finalVerdict = Verdict.MEMORY_LIMIT_EXCEEDED;
          } else {
            finalVerdict = Verdict.RUNTIME_ERROR;
          }
          error = res.files?.stderr || "";
        } else {
          const userOutput = res.files?.stdout || "";

          if (isSpj) {
            const checkerRes = await callGoJudge({
              cmd: [
                {
                  args: ["./checker", "input.in", "user.out", "answer.out"],
                  env: ["PATH=/usr/bin:/bin"],
                  files: [
                    { content: "", name: "stdout", max: 10485760 },
                    { content: "", name: "stderr", max: 10485760 },
                  ],
                  cpuLimit: 10000 * 1000000,
                  memoryLimit: 512 * 1024 * 1024,
                  procLimit: 50,
                  copyIn: {
                    checker: { fileId: checkerFileId },
                    "input.in": { content: testCase.in },
                    "user.out": { content: userOutput },
                    "answer.out": { content: testCase.out },
                  },
                },
              ],
            });
            const chkResult = checkerRes[0];
            if (chkResult.exitStatus !== 0) {
              finalVerdict = Verdict.WRONG_ANSWER;
            }
          } else {
            const stdOutput = cleanOutput(testCase.out);
            const myOutput = cleanOutput(userOutput);
            if (myOutput !== stdOutput) {
              finalVerdict = Verdict.WRONG_ANSWER;
            }
          }
        }
      }

      const timeMs = Math.floor(res.time / 1000000);
      const memoryKB = Math.floor(res.memory / 1024);
      maxTime = Math.max(maxTime, timeMs);
      maxMemory = Math.max(maxMemory, memoryKB);

      if (finalVerdict !== Verdict.ACCEPTED) {
        await updateProgress(submissionId, {
          verdict: finalVerdict,
          passedTests: i,
          totalTests: testCases.length,
          finished: false,
        });
        break;
      }

      passedCount++;
      await updateProgress(submissionId, {
        verdict: Verdict.JUDGING,
        passedTests: i + 1,
        totalTests: testCases.length,
        finished: false,
      });
    }

    await updateProgress(submissionId, {
      verdict: finalVerdict,
      passedTests: passedCount,
      totalTests: testCases.length,
      finished: true,
    });

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: finalVerdict,
        timeUsed: maxTime,
        memoryUsed: maxMemory,
        errorMessage: error,
        passedTests: passedCount,
        totalTests: testCases.length,
      },
    });

  } catch (error) {
    console.error("Judge Error:", error);
    const err = error as Error;
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        verdict: Verdict.SYSTEM_ERROR,
        errorMessage: submission.problem.type === "communication"
          ? "Communication judge failed. Please contact the problem setter."
          : err.message || "Unknown System Error",
      },
    });
    await redis.del(`submission:${submissionId}:progress`);
  } finally {
    await Promise.all([executableFileId, checkerFileId, interactorFileId, communicatorFileId].filter(Boolean).map(deleteTmpFile));
  }
}
