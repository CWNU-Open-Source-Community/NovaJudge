import { getCommunicationOutputLimit, getPolygonJudgeConfig, MAX_COMMUNICATION_OUTPUT_LIMIT, type PolygonJudgeConfig } from "../problem-judge-config";
import { programVerdict, testlibVerdict, type CommunicationCommand, type CommunicationResult, type CommunicationSandboxResult, type CommunicationTrace, type CommunicationVerdict } from "./communication";
import { getRunTimeLimits, getTimeLimitFailure } from "./runtime-limits";

const DIAGNOSTIC_LIMIT = 64 * 1024;

function dialoguePreview(output: string): string {
  const bytes = Buffer.from(output);
  return bytes.length > DIAGNOSTIC_LIMIT
    ? `${bytes.subarray(0, DIAGNOSTIC_LIMIT).toString()}\n[Interactive transcript truncated]`
    : output;
}

type Command = Omit<CommunicationCommand, "files"> & { files: (CommunicationCommand["files"][number] | null)[] };
export interface PolygonRequest {
  cmd: Command[];
  pipeMapping?: {
    in: { index: number; fd: number };
    out: { index: number; fd: number };
    proxy: boolean;
    name: string;
    max: number;
  }[];
}

export interface PolygonCaseOptions {
  execute: (request: PolygonRequest) => Promise<CommunicationSandboxResult[]>;
  args: string[];
  env: string[];
  program: CommunicationCommand["copyIn"];
  checkerFileId: string;
  interactorFileId?: string;
  input: string;
  answer: string;
  timeLimit: number;
  memoryLimit: number;
  stackLimit: number;
  polygon: PolygonJudgeConfig;
  communication?: unknown;
  captureTrace?: boolean;
}

/** Polygon's output chain: stdout (ordinary run) or testlib tout (interactive run), then checker. */
export async function runPolygonCase(options: PolygonCaseOptions): Promise<CommunicationResult> {
  const polygon = getPolygonJudgeConfig(options.polygon)!;
  if (!polygon || !options.checkerFileId || (polygon.interactor_runs.length && !options.interactorFileId)) {
    throw new Error("Polygon checker/interactor is not configured.");
  }
  const outputLimit = polygon.run_count === 2 ? getCommunicationOutputLimit(options.communication) : 10 * 1024 * 1024;
  const programLimits = getRunTimeLimits(options.timeLimit);
  const judgeLimits = getRunTimeLimits(10_000_000_000);
  let timeUsedMs = 0;
  let memoryUsedKb = 0;
  let actualOutput = "";
  let forwardedInput = options.input;
  const trace: CommunicationTrace = { firstOutput: "", secondInput: "", firstTimeUsedMs: 0, secondTimeUsedMs: 0 };

  function finish(verdict: CommunicationVerdict, message = ""): CommunicationResult {
    return {
      verdict, message, timeUsedMs, memoryUsedKb, actualOutput,
      ...(options.captureTrace && polygon.run_count === 2 ? { communication: trace } : {}),
    };
  }
  function judgeFailure(label: string, result: CommunicationSandboxResult) {
    const verdict = testlibVerdict(result);
    // testlib diagnostics may contain private input or reference answers.
    const diagnostic = options.captureTrace ? result.files?.stderr || result.error || result.status : verdict;
    return finish(verdict, `${label}: ${diagnostic}`);
  }
  async function execute(request: PolygonRequest) {
    const results = await options.execute(request);
    if (!Array.isArray(results) || results.length !== request.cmd.length || results.some((result) => !result)) {
      throw new Error("Incomplete Polygon judge response.");
    }
    return results;
  }

  for (let run = 1; run <= polygon.run_count; run++) {
    const interactive = polygon.interactor_runs.includes(run as 1 | 2);
    const program: Command = {
      args: options.args, env: options.env,
      files: [
        interactive ? null : { content: forwardedInput },
        interactive ? null : { name: "stdout", max: outputLimit },
        { name: "stderr", max: DIAGNOSTIC_LIMIT },
      ],
      ...programLimits, memoryLimit: options.memoryLimit, stackLimit: options.stackLimit, procLimit: 50,
      // Every invocation is a fresh sandbox containing only the submitted program.
      copyIn: options.program,
    };
    const request: PolygonRequest = { cmd: [program] };
    if (interactive) {
      request.cmd.push({
        args: ["./interactor", "input.in", "tout.txt", "answer.out"],
        env: ["PATH=/usr/bin:/bin"],
        files: [null, null, { name: "stderr", max: DIAGNOSTIC_LIMIT }],
        ...judgeLimits, clockLimit: Math.max(judgeLimits.clockLimit, programLimits.clockLimit),
        memoryLimit: 512 * 1024 * 1024, procLimit: 50,
        copyIn: {
          interactor: { fileId: options.interactorFileId! },
          "input.in": { content: forwardedInput },
          "answer.out": { content: options.answer },
        },
        copyOut: ["tout.txt"], copyOutMax: MAX_COMMUNICATION_OUTPUT_LIMIT,
      });
      request.pipeMapping = [
        // proxy.max only bounds the diagnostic capture; the full dialogue keeps flowing.
        // Query/message constraints belong to the interactor, not the transcript size.
        { in: { index: 0, fd: 1 }, out: { index: 1, fd: 0 }, proxy: true, name: "stdout", max: DIAGNOSTIC_LIMIT + 1 },
        { in: { index: 1, fd: 1 }, out: { index: 0, fd: 0 }, proxy: true, name: "stdout", max: DIAGNOSTIC_LIMIT + 1 },
      ];
    }
    const [result, interactor] = await execute(request);
    const time = Number.isFinite(result.time) ? Math.max(0, Math.floor(result.time / 1_000_000)) : 0;
    const memory = Number.isFinite(result.memory) ? Math.max(0, Math.floor(result.memory / 1024)) : 0;
    timeUsedMs = Math.max(timeUsedMs, time);
    memoryUsedKb = Math.max(memoryUsedKb, memory);
    actualOutput = interactive ? dialoguePreview(result.files?.stdout || "") : result.files?.stdout || "";
    if (run === 1) {
      trace.firstOutput = actualOutput;
      trace.firstTimeUsedMs = time;
    } else {
      trace.secondInput = interactive ? dialoguePreview(interactor.files?.stdout || "") : forwardedInput;
      trace.secondTimeUsedMs = time;
    }

    const verdict = programVerdict(result, programLimits);
    const timeFailure = getTimeLimitFailure(result, programLimits);
    if (timeFailure) return finish(timeFailure.verdict, `Run ${run}: ${timeFailure.message}`);
    if (!interactive && Buffer.byteLength(actualOutput) > outputLimit) return finish("WRONG_ANSWER", `Run ${run}: output exceeds ${outputLimit} bytes.`);
    if (["MEMORY_LIMIT_EXCEEDED", "SYSTEM_ERROR", "WRONG_ANSWER"].includes(verdict)) {
      return finish(verdict, `Run ${run}: ${result.status}`);
    }
    // A rejected interaction can close the pipe and cause a secondary solution RE (SIGPIPE).
    if (interactive && testlibVerdict(interactor) !== "ACCEPTED") return judgeFailure(`Interactor run ${run}`, interactor);
    if (verdict !== "ACCEPTED") {
      return finish(verdict, `Run ${run}: ${options.captureTrace ? result.files?.stderr || result.status : result.status}`);
    }
    if (interactive && typeof interactor.files?.["tout.txt"] !== "string") {
      return finish("SYSTEM_ERROR", `Interactor run ${run}: missing tout output.`);
    }
    forwardedInput = interactive ? interactor.files!["tout.txt"] : actualOutput;
  }

  const [checked] = await execute({ cmd: [{
    args: ["./checker", "input.in", "user.out", "answer.out"],
    env: ["PATH=/usr/bin:/bin"],
    files: [{ content: "" }, { name: "stdout", max: DIAGNOSTIC_LIMIT }, { name: "stderr", max: DIAGNOSTIC_LIMIT }],
    ...judgeLimits, memoryLimit: 512 * 1024 * 1024, procLimit: 50,
    copyIn: {
      checker: { fileId: options.checkerFileId },
      // The final checker always sees the ORIGINAL input, including for interactive run two.
      "input.in": { content: options.input },
      "user.out": { content: forwardedInput },
      "answer.out": { content: options.answer },
    },
  }] });
  return testlibVerdict(checked) === "ACCEPTED" ? finish("ACCEPTED") : judgeFailure("Polygon checker", checked);
}
