import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { faFileArchive } from "@fortawesome/free-solid-svg-icons";
import DomjudgeHomeUpdates from "./DomjudgeHomeUpdates";
import LiveVerdict from "@/components/LiveVerdict";
import { contestLanguages } from "@/lib/contest-languages";
import { getContestTeamStandings, scoreContestTeam, type StandingsProblem } from "@/lib/contest-team-standings";
import { boardTeamDetails, boardTeamInfo, elapsedContestTime, scoreboardClock } from "@/lib/domjudge-scoreboard";
import type { Contest, User } from "@/lib/generated/prisma/client";
import { getOrganizationDirectory } from "@/lib/org-mapper";
import { prisma } from "@/lib/prisma";
import { DomjudgeTeamButton } from "./DomjudgeBoardDialog";
import DomjudgeClarificationRow from "./DomjudgeClarificationRow";
import DomjudgeClarificationRequest from "./DomjudgeClarificationRequest";
import DomjudgeIcon from "./DomjudgeIcon";
import DomjudgeScoreSummary from "./DomjudgeScoreSummary";
import { ProblemBadge } from "./DomjudgeScoreBadges";

interface Props {
  contest: Pick<Contest, "id" | "title" | "startTime" | "endTime" | "status" | "config">;
  team: Pick<User, "id" | "username" | "displayName" | "school" | "category" | "members" | "coach">;
}

type Message = { id: number; displayId: string | null; time: Date; content: string; to: "all" | "you" | "jury" };

function Clarifications({ messages, contest, team, problems, requests = false }: Props & {
  messages: Message[]; problems: Map<string, StandingsProblem>; requests?: boolean;
}) {
  if (!messages.length) return <p className="dj-empty">{requests ? "No clarification request." : "No clarifications."}</p>;
  return <table className="dj-data-table dj-clarifications">
    <thead><tr><th scope="col">time</th><th scope="col">subject</th><th scope="col">to</th><th scope="col">text</th></tr></thead>
    <tbody>{messages.map(message => {
      const href = `/contest/${contest.id}/clarifications/${message.id}`;
      const problem = message.displayId ? problems.get(message.displayId) : null;
      const unquoted = message.content.split(/\r?\n/).filter(line => line && !line.startsWith(">")).join(" ");
      const characters = Array.from(unquoted || message.content.trim());
      const excerpt = characters.length > 121 ? characters.slice(0, 120).join("") + "…" : characters.join("");
      const cells = <>
        <td><Link href={href}><time dateTime={message.time.toISOString()}>{elapsedContestTime(contest.startTime, message.time)}</time></Link></td>
        <td><Link href={href}>{problem ? <ProblemBadge problem={problem} /> : "General issue"}</Link></td>
        <td>{message.to}</td>
        <td><Link className="dj-excerpt" href={href}>
          <ReactMarkdown skipHtml remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
            components={{ a: ({ children }) => <>{children}</>, p: ({ children }) => <span className="dj-excerpt-line">{children}</span>, img: () => null }}>
            {excerpt}
          </ReactMarkdown>
        </Link></td>
      </>;
      return requests ? <tr key={message.id}>{cells}</tr> : <DomjudgeClarificationRow key={message.id}
        storageKey={`domjudge-read:${contest.id}:${team.id}:${message.id}`} activity={+message.time}>{cells}</DomjudgeClarificationRow>;
    })}</tbody>
  </table>;
}

export default async function DomjudgeTeamHome({ contest, team }: Props) {
  const contestId = contest.id;
  const base = `/contest/${contestId}`;
  const now = new Date();
  const { started, frozen, freezeAt } = scoreboardClock(contest, now);
  const [standings, submissions, threads, organizations] = await Promise.all([
    started ? getContestTeamStandings(contest, { visibleUntil: now, freezeAt, maskFrozenVerdicts: true }) : null,
    started ? prisma.submission.findMany({
      where: { contestId, userId: team.id, globalUserId: null, virtualParticipationId: null },
      orderBy: [{ submittedAt: "desc" }, { displayId: "desc" }],
      select: { id: true, displayId: true, submittedAt: true, problemId: true, language: true, verdict: true },
    }) : [],
    prisma.clarification.findMany({
      where: { contestId, OR: [{ isPublic: true }, { userId: team.id }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, displayId: true, createdAt: true, content: true, title: true, category: true, userId: true, isPublic: true,
        replies: {
          where: { user: { role: { in: ["ADMIN", "JUDGE"] } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1, select: { createdAt: true, content: true },
        },
      },
    }),
    getOrganizationDirectory(),
  ]);
  const details = boardTeamDetails(team, boardTeamInfo(team, organizations));
  const problems = standings?.problems ?? [];
  const byDisplayId = new Map(problems.map(problem => [problem.displayId, problem]));
  const byProblemId = new Map(problems.map(problem => [problem.problemId, problem]));
  const latestSubmissionByProblem = new Map<number, number>();
  for (const { problemId, displayId } of submissions) {
    if (!latestSubmissionByProblem.has(problemId)) latestSubmissionByProblem.set(problemId, displayId);
  }
  let score = standings?.rankings.find(row => row.id === team.id);
  if (frozen && standings && score) {
    // Rank, medals and first-to-solve come from the published board. Only this team's score is live.
    const personalScore = scoreContestTeam(submissions.toReversed(), problems, contest, {
      end: Math.min(+now, +contest.endTime), firstSolves: standings.firstSolves,
    });
    score = { ...score, ...personalScore };
  }
  const incoming: Message[] = [];
  const requests: Message[] = [];
  for (const thread of threads) {
    const original = { id: thread.id, displayId: thread.displayId, time: thread.createdAt,
      content: thread.content || thread.title || "" };
    if (thread.userId === team.id && thread.category === "QUESTION") requests.push({ ...original, to: "jury" });
    const reply = thread.replies[0];
    if (reply || thread.isPublic) incoming.push({
      ...original, to: thread.isPublic ? "all" : "you",
      time: reply?.createdAt ?? original.time, content: reply?.content ?? original.content,
    });
  }
  incoming.sort((a, b) => +b.time - +a.time || b.id - a.id);

  return <div className="dj-home" lang="en">
    <DomjudgeHomeUpdates key={team.id} contestId={contestId} latest={incoming[0] && {
      id: incoming[0].id, time: +incoming[0].time, text: incoming[0].content.slice(0, 120),
    }} />
    {started ? <h1 className="sr-only">{contest.title} · Team home</h1> :
      <header className="dj-welcome"><h1>Welcome team <DomjudgeTeamButton team={details}>{details.name}</DomjudgeTeamButton>!</h1>
        <p>{contest.title} starts <time dateTime={contest.startTime.toISOString()}>{contest.startTime.toLocaleString("en-GB", { timeZoneName: "short" })}</time>.</p>
      </header>}
    {score && <DomjudgeScoreSummary base={base} problems={problems} team={score} details={details} frozen={frozen}
      latestSubmissionByProblem={latestSubmissionByProblem} />}
    <div className={started ? "dj-home-columns" : "dj-before-start"}>
      {started && <section aria-labelledby="dj-submissions">
        <h2 className="dj-section-title" id="dj-submissions">Submissions</h2>
        {submissions.length === 0 ? <p className="dj-no-submissions">No submissions</p> :
          <div className="dj-table-scroll"><table className="dj-data-table dj-submissions">
            <thead><tr><th scope="col">time</th><th scope="col">problem</th><th scope="col">lang</th>
              <th scope="col">result</th><th scope="col"><span className="sr-only">Source code</span></th></tr></thead>
            <tbody>{submissions.map(submission => {
              const href = `${base}/status/${submission.displayId}`;
              const problem = byProblemId.get(submission.problemId);
              return <tr key={submission.id} id={`dj-submission-${submission.displayId}`}>
                <td><Link href={href}><time dateTime={submission.submittedAt.toISOString()}>{elapsedContestTime(contest.startTime, submission.submittedAt)}</time></Link></td>
                <td><Link href={href}>{problem ? <ProblemBadge problem={problem} /> : "–"}</Link></td>
                <td><Link href={href}>{contestLanguages.find(item => item.value === submission.language)?.label ?? submission.language}</Link></td>
                <td><Link href={href}>{submission.submittedAt > contest.endTime && <span className="dj-result">too-late / </span>}
                  <LiveVerdict key={submission.verdict} submissionId={submission.id} initialStatus={submission.verdict} domjudgeHref={href} />
                </Link></td>
                <td><a href={`/api/contests/${contestId}/submissions/${submission.id}/source`} download
                  title="Download submission ZIP" aria-label={`Download source ZIP for submission ${submission.displayId}`}>
                  <DomjudgeIcon icon={faFileArchive} />
                </a></td>
              </tr>;
            })}</tbody>
          </table></div>}
      </section>}
      {(started || incoming.length > 0) && <section aria-labelledby="dj-clarifications">
        <h2 className="dj-section-title" id="dj-clarifications"><Link href={`${base}/clarifications`}>Clarifications</Link></h2>
        <Clarifications messages={incoming} contest={contest} team={team} problems={byDisplayId} />
        {started && <>
          <h2 className="dj-section-title">Clarification Requests</h2>
          <Clarifications messages={requests} requests contest={contest} team={team} problems={byDisplayId} />
          <DomjudgeClarificationRequest contestId={contestId} problems={problems.map(problem => problem.displayId)} />
        </>}
      </section>}
    </div>
  </div>;
}
