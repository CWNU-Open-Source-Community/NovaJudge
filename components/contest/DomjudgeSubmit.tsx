"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { CloudArrowUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { en as dict } from "@/lib/dictionaries";
import { submitTeamFile } from "@/app/(main)/contest/[contestId]/(board)/submit/actions";
import { contestLanguages, languageFromFilename } from "@/lib/contest-languages";
import type { DomjudgeContest } from "@/lib/domjudge-contest";
import { faCloudUploadAlt } from "@fortawesome/free-solid-svg-icons";
import DomjudgeIcon from "./DomjudgeIcon";

interface Props {
  contest: DomjudgeContest;
  initialProblem?: string;
  onClose?: () => void;
}

export function ProblemSubmitButton({ contest, problem }: { contest: DomjudgeContest; problem: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="dj-success" disabled={!contest.canSubmit} onClick={() => setOpen(true)}>
      <DomjudgeIcon icon={faCloudUploadAlt} />Submit
    </button>
    {open && <DomjudgeSubmit contest={contest} initialProblem={problem} onClose={() => setOpen(false)} />}
  </>;
}

export default function DomjudgeSubmit({ contest, initialProblem, onClose }: Props) {
  const router = useRouter();
  const fieldId = useId();
  const [problem, setProblem] = useState(initialProblem ?? "");
  const [inferProblem, setInferProblem] = useState(!initialProblem);
  const [language, setLanguage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const fileExtensions = contestLanguages.flatMap(entry => entry.extensions.map(ext => `.${ext}`)).join(",");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("source");
    if (!(file instanceof File) || !problem || !language || pending) return;
    setError("");
    startTransition(async () => {
      let code: string;
      try {
        code = await file.text();
      } catch {
        setError(dict.domjudge.readFailed);
        return;
      }
      if (!code.trim()) {
        setError(dict.domjudge.emptyFile);
        return;
      }
      try {
        const result = await submitTeamFile(contest.id, problem, language, code);
        if (result) {
          setError(dict.submissionErrors[result.error]);
          return;
        }
      } catch {
        setError(dict.submissionErrors.failed);
        return;
      }
      onClose?.();
      router.push(`/contest/${contest.id}`);
      router.refresh();
    });
  }

  const form = !contest.canSubmit ? <p className="dj-submissions-closed">
    {contest.ended ? "Submissions are closed for this contest." : dict.submit.unavailable}
  </p> : (
    <form onSubmit={handleSubmit} className="dj-submit-form">
      <fieldset disabled={pending}>
        <div className="dj-field">
          <label htmlFor={fieldId + "-source"}>{dict.domjudge.sourceFile}</label>
          <input id={fieldId + "-source"} type="file" name="source" required accept={fileExtensions} onChange={event => {
            setError("");
            const file = event.target.files?.[0];
            if (!file) return;
            setLanguage(languageFromFilename(file.name) ?? "");
            const basename = file.name.replace(/\.[^.]+$/, "").toLowerCase();
            const match = contest.problems.find(item => item.displayId.toLowerCase() === basename);
            if (inferProblem) setProblem(match?.displayId ?? "");
          }} />
        </div>
        <div className="dj-field">
          <label htmlFor={fieldId + "-problem"}>{dict.common.problem}</label>
          <select id={fieldId + "-problem"} required value={problem} onChange={event => {
            setProblem(event.target.value);
            setInferProblem(!event.target.value);
          }}>
            <option value="">{dict.domjudge.chooseProblem}</option>
            {contest.problems.map(item =>
              <option key={item.displayId} value={item.displayId}>{item.displayId} – {item.title}</option>
            )}
          </select>
        </div>
        <div className="dj-field">
          <label htmlFor={fieldId + "-language"}>{dict.common.language}</label>
          <select id={fieldId + "-language"} required value={language} onChange={event => setLanguage(event.target.value)}>
            <option value="">{dict.domjudge.chooseLanguage}</option>
            {contestLanguages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {error && <p className="dj-error" role="alert">{error}</p>}
        <div className="dj-form-actions">
          {problem && !pending && <Link href={`/contest/${contest.id}/submit?problem=${encodeURIComponent(problem)}`}
            onClick={onClose} className="dj-editor-link">{dict.domjudge.pasteCode}</Link>}
          {onClose && <button type="button" className="dj-secondary" onClick={onClose}>{dict.common.cancel}</button>}
          <button type="submit" className="dj-success">
            <CloudArrowUpIcon aria-hidden="true" />{pending ? dict.domjudge.submitting : dict.common.submit}
          </button>
        </div>
      </fieldset>
    </form>
  );

  if (!onClose) return form;
  return (
    <Dialog open onClose={() => { if (!pending) onClose(); }} className="dj-dialog">
      <div className="dj-backdrop" aria-hidden="true" />
      <div className="dj-dialog-position">
        <DialogPanel className="dj-dialog-panel">
          <header>
            <DialogTitle>{dict.submit.title}</DialogTitle>
            <button type="button" disabled={pending} aria-label={dict.common.close} onClick={onClose}><XMarkIcon className="size-5" /></button>
          </header>
          {form}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
