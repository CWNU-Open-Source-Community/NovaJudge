import { redirect } from "next/navigation";
import { requireContestAccess } from "@/lib/contest-access";
import { usesDomjudge } from "@/lib/contest-interface";
import { contestLanguages } from "@/lib/contest-languages";

export default async function ContestLanguages({ params }: { params: Promise<{ contestId: string }> }) {
  const contestId = Number((await params).contestId);
  await requireContestAccess(contestId);
  if (!await usesDomjudge(contestId)) redirect(`/contest/${contestId}`);
  return <section className="dj-languages" lang="en">
    <h1>Allowed Languages</h1>
    <div>{contestLanguages.map(language =>
      <article key={language.value}>
        <h2>{language.label}</h2>
        <ul aria-label="File extensions">{language.extensions.map(ext => <li key={ext}>.{ext}</li>)}</ul>
      </article>
    )}</div>
  </section>;
}
