import { getCommunicationOutputLimit } from "../problem-judge-config";

const SECOND = 1_000_000_000;
const DIAGNOSTIC_LIMIT = 64 * 1024;
const SECOND_INPUT_LIMIT = 16 * 1024 * 1024;
const STATE_LIMIT = 1024 * 1024;

export type CommunicationVerdict =
  | "ACCEPTED"
  | "WRONG_ANSWER"
  | "PRESENTATION_ERROR"
  | "TIME_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED"
  | "RUNTIME_ERROR"
  | "SYSTEM_ERROR";

type SandboxFile = { content: string } | { fileId: string };
export interface CommunicationCommand {
  args: string[];
  env: string[];
  files: ({ content: string } | { name: string; max: number })[];
  cpuLimit: number;
  clockLimit: number;
  memoryLimit: number;
  procLimit: number;
  stackLimit?: number;
  copyIn: Record<string, SandboxFile>;
  copyOut?: string[];
  copyOutMax?: number;
}

export interface CommunicationSandboxResult {
  status: string;
  exitStatus: number;
  time: number;
  memory: number;
  error?: string;
  files?: Record<string, string>;
}

type Execute = (request: { cmd: CommunicationCommand[] }) => Promise<CommunicationSandboxResult[]>;

export interface CommunicationTrace {
  firstOutput: string;
  secondInput: string;
  firstTimeUsedMs: number;
  secondTimeUsedMs: number;
}

export interface CommunicationResult {
  verdict: CommunicationVerdict;
  message: string;
  timeUsedMs: number;
  memoryUsedKb: number;
  actualOutput: string;
  communication?: CommunicationTrace;
}

interface CommunicationOptions {
  execute: Execute;
  args: string[];
  env: string[];
  program: Record<string, SandboxFile>;
  communicatorFileId: string;
  input: string;
  answer: string;
  timeLimit: number;
  memoryLimit: number;
  stackLimit: number;
  config?: unknown;
  captureTrace?: boolean;
}

function programVerdict(result: CommunicationSandboxResult): CommunicationVerdict {
  switch (result.status) {
    case "Accepted": return result.exitStatus === 0 ? "ACCEPTED" : "RUNTIME_ERROR";
    case "Time Limit Exceeded": return "TIME_LIMIT_EXCEEDED";
    case "Memory Limit Exceeded": return "MEMORY_LIMIT_EXCEEDED";
    // Message size is part of a communication problem's output contract.
    case "Output Limit Exceeded": return "WRONG_ANSWER";
    case "File Error":
    case "Internal Error": return "SYSTEM_ERROR";
    default: return "RUNTIME_ERROR";
  }
}

function communicatorVerdict(result: CommunicationSandboxResult): CommunicationVerdict {
  if (!["Accepted", "Nonzero Exit Status"].includes(result.status)) return "SYSTEM_ERROR";
  switch (result.exitStatus) {
    case 0: return result.status === "Accepted" ? "ACCEPTED" : "SYSTEM_ERROR";
    case 1:
    case 8: return "WRONG_ANSWER";
    case 2: return "PRESENTATION_ERROR";
    // Includes testlib _fail, unsupported partial scores and crashes.
    default: return "SYSTEM_ERROR";
  }
}

/** Run-twice: never carry a solution's working files or memory into run two. */
export async function runCommunicationCase(options: CommunicationOptions): Promise<CommunicationResult> {
  if (!options.communicatorFileId) throw new Error("Communication judge is not configured.");
  const outputLimit = getCommunicationOutputLimit(options.config);
  let timeUsedMs = 0;
  let memoryUsedKb = 0;
  let actualOutput = "";
  const trace: CommunicationTrace = {
    firstOutput: "",
    secondInput: "",
    firstTimeUsedMs: 0,
    secondTimeUsedMs: 0,
  };

  function finish(verdict: CommunicationVerdict, message: string): CommunicationResult {
    return {
      verdict, message, timeUsedMs, memoryUsedKb, actualOutput,
      ...(options.captureTrace ? { communication: trace } : {}),
    };
  }

  async function execute(command: CommunicationCommand) {
    const results = await options.execute({ cmd: [command] });
    if (!Array.isArray(results) || !results[0]) throw new Error("Empty communication judge response.");
    return results[0];
  }

  async function runProgram(input: string, run: 1 | 2) {
    const result = await execute({
      args: options.args,
      env: options.env,
      files: [
        { content: input },
        { name: "stdout", max: outputLimit },
        { name: "stderr", max: DIAGNOSTIC_LIMIT },
      ],
      cpuLimit: options.timeLimit,
      clockLimit: Math.max(3 * options.timeLimit, 3 * SECOND),
      memoryLimit: options.memoryLimit,
      stackLimit: options.stackLimit,
      procLimit: 50,
      // Only the original compiled program (or interpreted source) is copied.
      copyIn: options.program,
    });
    const time = Number.isFinite(result.time) ? Math.max(0, Math.floor(result.time / 1_000_000)) : 0;
    const memory = Number.isFinite(result.memory) ? Math.max(0, Math.floor(result.memory / 1024)) : 0;
    timeUsedMs = Math.max(timeUsedMs, time);
    memoryUsedKb = Math.max(memoryUsedKb, memory);
    if (run === 1) trace.firstTimeUsedMs = time;
    else trace.secondTimeUsedMs = time;
    return result;
  }

  function programFailure(result: CommunicationSandboxResult, run: number) {
    const diagnostic = result.status === "Output Limit Exceeded"
      ? `output exceeds ${outputLimit} bytes`
      : options.captureTrace
        ? result.files?.stderr || result.error || result.status
        : result.status;
    return finish(programVerdict(result), `Run ${run}: ${diagnostic}`);
  }

  async function runCommunicator(mode: "prepare" | "check", userOutput: string, state?: string) {
    return execute({
      args: ["./communicator", "input.in", "user.out", "answer.out", mode],
      env: ["PATH=/usr/bin:/bin"],
      files: [
        { content: "" },
        { name: "stdout", max: mode === "prepare" ? SECOND_INPUT_LIMIT : DIAGNOSTIC_LIMIT },
        { name: "stderr", max: DIAGNOSTIC_LIMIT },
      ],
      cpuLimit: 10 * SECOND,
      clockLimit: 20 * SECOND,
      memoryLimit: 512 * 1024 * 1024,
      procLimit: 50,
      copyIn: {
        communicator: { fileId: options.communicatorFileId },
        "input.in": { content: options.input },
        "user.out": { content: userOutput },
        "answer.out": { content: options.answer },
        ...(mode === "check" ? {
          "first.out": { content: trace.firstOutput },
          "second.in": { content: trace.secondInput },
          ...(state === undefined ? {} : { "state.txt": { content: state } }),
        } : {}),
      },
      ...(mode === "prepare" ? { copyOut: ["state.txt?"], copyOutMax: STATE_LIMIT } : {}),
    });
  }

  function judgeMessage(mode: "prepare" | "check", result: CommunicationSandboxResult) {
    // A testlib diagnostic can contain private inputs, answers or judge state.
    // Detailed diagnostics are only returned for the admin's sample debugger.
    const diagnostic = options.captureTrace
      ? result.files?.stderr || result.error || result.status
      : communicatorVerdict(result);
    return `Communication ${mode}: ${diagnostic}`;
  }

  const first = await runProgram(options.input, 1);
  trace.firstOutput = first.files?.stdout || "";
  if (programVerdict(first) !== "ACCEPTED") return programFailure(first, 1);

  const prepared = await runCommunicator("prepare", trace.firstOutput);
  const preparationVerdict = communicatorVerdict(prepared);
  if (preparationVerdict !== "ACCEPTED") {
    return finish(preparationVerdict, judgeMessage("prepare", prepared));
  }
  trace.secondInput = prepared.files?.stdout || "";
  const state = prepared.files?.["state.txt"];

  const second = await runProgram(trace.secondInput, 2);
  actualOutput = second.files?.stdout || "";
  if (programVerdict(second) !== "ACCEPTED") return programFailure(second, 2);

  const checked = await runCommunicator("check", actualOutput, state);
  const verdict = communicatorVerdict(checked);
  return finish(verdict, verdict === "ACCEPTED" ? "" : judgeMessage("check", checked));
}
