import JSZip from "jszip";
import { getPublicProblemSamples, type ProblemSample } from "./problem-samples";

type SampleProblem = {
  displayId: string; problemId: number; problem: { type: string; samples: unknown };
};

// Display IDs are editable. Keep ZIP directory names portable and distinct even
// for case-insensitive filesystems; the fallback contains a reserved separator.
export function sampleDirectory(displayId: string, problemId: number) {
  if (/^[\p{L}\p{N}_-]{1,60}$/u.test(displayId) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(displayId)) return displayId;
  return `problem~${problemId}`;
}

export async function contestSampleArchive(problems: SampleProblem[], all: boolean) {
  const zip = new JSZip();
  const directories = new Set<string>();
  let pairs = 0;
  for (const { displayId, problemId, problem } of problems) {
    if (!Array.isArray(problem.samples) || !problem.samples.length) continue;
    const samples = getPublicProblemSamples(problem.type, problem.samples as ProblemSample[]);
    let folder = sampleDirectory(displayId, problemId);
    if (directories.has(folder.toLowerCase())) folder = `problem~${problemId}`;
    directories.add(folder.toLowerCase());
    samples.forEach(({ input, output }, index) => {
      const stem = (all ? folder + "/" : "") + (index + 1);
      zip.file(stem + ".in", input);
      zip.file(stem + ".ans", output);
    });
    pairs += samples.length;
  }
  return pairs ? zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" }) : null;
}
