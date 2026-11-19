"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import { updateContestStatement } from "./actions";

export default function ContestStatementManager({ contestId, hasBooklet, problems }: {
  contestId: number; hasBooklet: boolean;
  problems: { id: string; displayId: string; title: string; hasPdf: boolean }[];
}) {
  const { t } = useAdminLocale();
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const selected = problems.find(problem => problem.id === target);
  const hasPdf = selected ? selected.hasPdf : hasBooklet;
  const href = `/api/contests/${contestId}/problemset/statement.pdf` +
    (selected ? "?problem=" + encodeURIComponent(selected.displayId) : "");

  function save(data: FormData) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await updateContestStatement(contestId, target || null, data);
        const messages = {
          format: t("Choose a PDF file.", "请选择有效的 PDF 文件。"),
          size: t("The PDF must be 50 MB or smaller.", "PDF 不能超过 50 MB。"),
          target: t("This contest or problem is no longer available.", "比赛或题目已移除。"),
          ok: data.get("operation") === "remove" ? t("PDF removed.", "已移除 PDF。") : t("PDF uploaded.", "已上传 PDF。"),
        };
        setMessage(messages[result]);
        if (result === "ok") form.current?.reset();
      } catch {
        setMessage(t("Could not save the PDF. Please retry.", "保存失败，请重试。"));
      }
    });
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(new FormData(event.currentTarget));
  }

  return <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-6 shadow">
    <h2 className="font-bold text-lg text-gray-800">{t("Problem statement PDFs", "比赛题面 PDF")}</h2>
    <label className="block text-sm font-medium">
      {t("Upload for", "上传范围")}
      <select className="mt-1 w-full rounded border border-gray-300 p-2" value={target} disabled={pending}
        onChange={event => { setTarget(event.target.value); setMessage(""); }}>
        <option value="">{t("Entire contest booklet", "整场比赛题册")}</option>
        {problems.map(problem => <option key={problem.id} value={problem.id}>{problem.displayId} · {problem.title}{problem.hasPdf ? " (PDF)" : ""}</option>)}
      </select>
    </label>
    <div className="flex items-center justify-between gap-2 text-sm">
      {hasPdf ? <>
        <a className="text-blue-700 underline" href={href} download>{t("Download current PDF", "下载当前 PDF")}</a>
        <button type="button" disabled={pending} className="cursor-pointer text-red-700" onClick={() => {
          if (!window.confirm(t("Remove the selected PDF?", "移除当前选中的 PDF？"))) return;
          const data = new FormData(); data.set("operation", "remove"); save(data);
        }}>{t("Remove", "移除")}</button>
      </> : <span className="text-gray-500">{t("No PDF uploaded", "尚未上传 PDF")}</span>}
    </div>
    <form key={target} ref={form} onSubmit={upload}>
      <fieldset className="space-y-3" disabled={pending}>
        <label className="block text-sm">{t("PDF file (up to 50 MB)", "PDF 文件（最大 50 MB）")}
          <input className="mt-1 block w-full text-sm file:mr-2 file:cursor-pointer file:rounded file:bg-gray-100 file:px-3 file:py-2"
            type="file" name="pdf" accept=".pdf,application/pdf" required />
        </label>
        <button className="w-full cursor-pointer rounded bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
          {pending ? t("Saving…", "正在保存…") : hasPdf ? t("Replace PDF", "替换 PDF") : t("Upload PDF", "上传 PDF")}
        </button>
      </fieldset>
    </form>
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>;
}
