import type { Verdict } from "./generated/prisma/enums";

const binCount = 20;
type Bin = { correct: number; incorrect: number; frozen: boolean; start: number; end: number };
type Run = { problemId: number; submittedAt: Date; verdict: Verdict };

export function problemSubmissionStats(problemIds: number[], runs: readonly Run[], start: number, end: number, freezeAt: number) {
  const width = Math.max(1, (end - start) / binCount);
  const byProblem = new Map<number, Bin[]>();
  for (const id of problemIds) {
    byProblem.set(id, Array.from({ length: binCount }, (_, index) => {
      const until = Math.min(end, start + (index + 1) * width);
      return { start: start + index * width, end: until, frozen: until > freezeAt, correct: 0, incorrect: 0 };
    }));
  }
  let maxCorrect = 0;
  let maxIncorrect = 0;
  for (const run of runs) {
    const at = run.submittedAt.getTime();
    if (at < start || at > end) continue;
    const bin = byProblem.get(run.problemId)?.[Math.min(binCount - 1, Math.floor((at - start) / width))];
    if (!bin) continue;
    if (bin.frozen) {
      // The two rows show the same public total throughout a frozen bin.
      bin.correct++;
      bin.incorrect++;
    } else if (run.verdict === "ACCEPTED") {
      bin.correct++;
    } else if (run.verdict !== "PENDING" && run.verdict !== "JUDGING") {
      bin.incorrect++;
    }
    maxCorrect = Math.max(maxCorrect, bin.correct);
    maxIncorrect = Math.max(maxIncorrect, bin.incorrect);
  }
  return { byProblem, maxCorrect, maxIncorrect };
}
