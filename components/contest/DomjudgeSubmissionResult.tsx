export default function DomjudgeSubmissionResult({ result, announce = false }: { result: string; announce?: boolean }) {
  const pending = result === "pending" || result === "queued" || result === "judging";
  const style = pending ? "pending" : result === "correct" ? "correct" : "incorrect";
  return <span className={`dj-result dj-result-${style}`} aria-live={announce ? "polite" : undefined}>{result}</span>;
}
