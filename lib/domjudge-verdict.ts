import type { Verdict } from "./generated/prisma/enums";

export const domjudgeResult: Record<string, string> = {
  PENDING: "queued", JUDGING: "judging", ACCEPTED: "correct", WRONG_ANSWER: "wrong-answer",
  TIME_LIMIT_EXCEEDED: "timelimit", MEMORY_LIMIT_EXCEEDED: "memory-limit",
  RUNTIME_ERROR: "run-error", COMPILE_ERROR: "compiler-error", PRESENTATION_ERROR: "presentation-error",
  SYSTEM_ERROR: "judge-error",
};

export function scoreboardVerdict(verdict: Verdict, released: boolean) {
  if (verdict === "PENDING" || verdict === "JUDGING") return "pending";
  if (released || verdict === "ACCEPTED") return domjudgeResult[verdict];
  return "rejected";
}
