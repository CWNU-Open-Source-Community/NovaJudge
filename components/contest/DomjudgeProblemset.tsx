import Link from "next/link";
import { faDownload, faFileAlt, faFileArchive, faFilePdf } from "@fortawesome/free-solid-svg-icons";
import type { DomjudgeContest } from "@/lib/domjudge-contest";
import { elapsedContestTime } from "@/lib/domjudge-scoreboard";
import { problemSubmissionStats } from "@/lib/domjudge-problem-stats";
import { listContestStatements, statementFilename } from "@/lib/contest-statements";
import { getOfficialSubmissionWhere } from "@/lib/official-submission";
import { prisma } from "@/lib/prisma";
import { ProblemBadge } from "./DomjudgeScoreBadges";
import DomjudgeIcon from "./DomjudgeIcon";
import { ProblemSubmitButton } from "./DomjudgeSubmit";

const palettes = {
  correct: ["#eee", "#dcffe4", "#bef5cb", "#85e89d", "#34d058", "#28a745", "#22863a", "#176f2c", "#165c26", "#144620"],
  incorrect: ["#eee", "#ffdce0", "#fdaeb7", "#f97583", "#ea4a5a", "#d73a49", "#cb2431", "#b31d28", "#9e1c23", "#86181d"],
  frozen: ["#eee", "#dbedff", "#c8e1ff", "#79b8ff", "#2188ff", "#0366d6", "#005cc5", "#044289", "#032f62", "#05264c"],
};

function SubmissionChart({ start, stats, problemId }: {
  start: Date; stats: ReturnType<typeof problemSubmissionStats>; problemId: number;
}) {
  const bins = stats.byProblem.get(problemId)!;
  return <div className="dj-problem-stats" role="group" aria-label="Submissions over contest time">
    {(["correct", "incorrect"] as const).map(result => <div key={result} className="dj-stats-row">
      {bins.map((bin, index) => {
        const count = bin[result];
        const scale = bin.frozen ? Math.max(stats.maxCorrect, stats.maxIncorrect) :
          result === "correct" ? stats.maxCorrect : stats.maxIncorrect;
        const kind = bin.frozen ? "frozen" : result;
        const color = palettes[kind][Math.ceil(count * 9 / (scale || 1))];
        const from = elapsedContestTime(start, new Date(bin.start));
        const to = elapsedContestTime(start, new Date(bin.end));
        const label = `${from}–${to} · ${count} ${kind} submission${count === 1 ? "" : "s"}`;
        return <span key={index} role="img" aria-label={label} title={label} style={{ backgroundColor: color }} />;
      })}
    </div>)}
  </div>;
}

export async function DomjudgeProblemset({ contest, now, freezeAt }: { contest: DomjudgeContest; now: Date; freezeAt: number }) {
  const start = new Date(contest.start);
  const end = new Date(contest.end);
  const contestId = contest.id;
  const [problems, runs, statements] = contest.started ? await Promise.all([
    prisma.contestProblem.findMany({
      where: { contestId }, orderBy: { displayId: "asc" },
      select: { id: true, displayId: true, problemId: true, color: true, realTimeLimit: true, realMemoryLimit: true,
        problem: { select: { title: true, type: true, samples: true, defaultTimeLimit: true, defaultMemoryLimit: true } } },
    }),
    prisma.submission.findMany({
      where: getOfficialSubmissionWhere({ contestId, startTime: start, endTime: end, visibleUntil: now }),
      select: { problemId: true, submittedAt: true, verdict: true },
    }),
    listContestStatements(contestId),
  ]) : [[], [], new Set<string>()] as const;
  const stats = problemSubmissionStats(problems.map(cp => cp.problemId), runs, contest.start, contest.end, freezeAt);
  const downloads = `/api/contests/${contestId}/problemset`;
  const hasSamples = problems.some(({ problem }) => Array.isArray(problem.samples) && problem.samples.length);
  return <section className="dj-problemset" lang="en">
    <header>
      <h1>{contest.title} problems</h1>
      <div className="dj-set-downloads">
        {statements.has(statementFilename(null)) && <a className="dj-secondary" href={downloads + "/statement.pdf"} download
          title="Download the contest problemset PDF"><DomjudgeIcon icon={faFilePdf} />problemset</a>}
        {hasSamples && <a className="dj-secondary" href={downloads + "/samples.zip"} download
          title="Download samples for all problems"><DomjudgeIcon icon={faDownload} />samples</a>}
      </div>
    </header>
    {problems.length === 0 ? <p className="dj-no-problems">No problem texts available at this point.</p> :
      <ul className="dj-cards">
        {problems.map(cp => {
          const statement = `/contest/${contestId}/problems/${encodeURIComponent(cp.displayId)}`;
          const query = "?problem=" + encodeURIComponent(cp.displayId);
          const seconds = (cp.realTimeLimit ?? cp.problem.defaultTimeLimit) / 1000;
          const memory = cp.realMemoryLimit ?? cp.problem.defaultMemoryLimit;
          const type = cp.problem.type === "default" || cp.problem.type === "spj" ? "pass-fail" : cp.problem.type;
          return <li key={cp.id} className="dj-problem-card">
            <h2 aria-label={`Problem ${cp.displayId}`}><ProblemBadge problem={cp} /></h2>
            <h3><Link href={statement}>{cp.problem.title}</Link></h3>
            <p>Limits: {seconds} {seconds === 1 ? "second" : "seconds"} / {memory >= 1024 && memory % 1024 === 0 ? `${memory / 1024} GB` : `${memory} MB`}</p>
            <p>Type: {type}</p>
            <SubmissionChart start={start} stats={stats} problemId={cp.problemId} />
            <div className="dj-problem-submit"><ProblemSubmitButton contest={contest} problem={cp.displayId} /></div>
            <div className="dj-card-downloads">
              {statements.has(statementFilename(cp.id))
                ? <a className="dj-secondary" href={downloads + "/statement.pdf" + query} download title="Download statement PDF">
                    <DomjudgeIcon icon={faFilePdf} />statement</a>
                : <Link className="dj-secondary" href={statement} title="Read the problem statement">
                    <DomjudgeIcon icon={faFileAlt} />statement</Link>}
              {Array.isArray(cp.problem.samples) && cp.problem.samples.length > 0 &&
                <a className="dj-secondary" href={downloads + "/samples.zip" + query} download title="Download sample inputs and outputs">
                  <DomjudgeIcon icon={faFileArchive} />samples</a>}
            </div>
          </li>;
        })}
      </ul>}
  </section>;
}
