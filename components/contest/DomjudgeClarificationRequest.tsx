"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { submitQuestion } from "@/app/(main)/contest/[contestId]/(board)/clarifications/actions";
import { en } from "@/lib/dictionaries";

export default function DomjudgeClarificationRequest({ contestId, problems }: { contestId: number; problems: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  function send(data: FormData) {
    const content = String(data.get("content") ?? "").trim();
    if (!content) { setError("Enter a clarification message."); return; }
    data.set("contestId", String(contestId));
    data.set("title", content.split(/\r?\n/, 1)[0].slice(0, 100));
    startTransition(async () => {
      try {
        const result = await submitQuestion(data);
        if (result.error) { setError(en.clarifications[result.error]); return; }
        setOpen(false);
        router.refresh();
      } catch {
        setError(en.clarifications.questionFailed);
      }
    });
  }
  return <>
    <button type="button" className="dj-secondary dj-request" onClick={() => { setError(""); setOpen(true); }}>Request clarification</button>
    {open && <Dialog open onClose={() => { if (!pending) setOpen(false); }} className="dj-dialog" lang="en">
      <div className="dj-backdrop" aria-hidden="true" />
      <div className="dj-dialog-position"><DialogPanel className="dj-dialog-panel">
        <header><DialogTitle>Request clarification</DialogTitle>
          <button type="button" aria-label="Close" disabled={pending} onClick={() => setOpen(false)}><XMarkIcon className="size-5" /></button>
        </header>
        <form className="dj-submit-form" onSubmit={event => { event.preventDefault(); send(new FormData(event.currentTarget)); }}>
          <fieldset disabled={pending}>
            <div className="dj-field"><label htmlFor="dj-clarification-subject">Subject</label>
              <select id="dj-clarification-subject" name="displayId" defaultValue="General">
                <option value="General">General issue</option>
                {problems.map(id => <option key={id} value={id}>Problem {id}</option>)}
              </select>
            </div>
            <div className="dj-field"><label htmlFor="dj-clarification-message">Message</label>
              <textarea id="dj-clarification-message" name="content" required rows={6} />
            </div>
            {error && <p role="alert" className="dj-error">{error}</p>}
            <div className="dj-form-actions">
              <button type="button" className="dj-secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="dj-success">{pending ? "Sending…" : "Send"}</button>
            </div>
          </fieldset>
        </form>
      </DialogPanel></div>
    </Dialog>}
  </>;
}
