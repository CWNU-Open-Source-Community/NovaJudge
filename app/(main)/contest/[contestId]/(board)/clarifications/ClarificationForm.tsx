"use client";

import { submitQuestion, submitReply } from "./actions";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage } from "@/lib/dictionaries";
import { toast } from "sonner";
import { useRef } from "react";

interface Props {
  contestId: number;
  problems: { displayId: string; problemId: number }[];
}

export default function ClarificationForm({
  contestId,
  problems,
}: Props) {
  const { dict } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const res = await submitQuestion(formData);
    if (res?.error) {
      toast.error(dict.clarifications[res.error]);
    } else if (res?.success) {
      toast.success(dict.clarifications.questionSubmitted);
      formRef.current?.reset();
    }
  }

  return (
    <section id="ask-question" className="scroll-mt-24 bg-white border border-gray-200 shadow-sm rounded-lg p-6 md:p-8">
      <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2 border-b border-gray-100 pb-2">
        {dict.clarifications.askQuestion}
      </h3>
      <form ref={formRef} action={handleSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="contestId" value={contestId} />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Select Problem */}
          <div className="md:col-span-1">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
              {dict.clarifications.problem}
            </label>
            <select
              name="displayId"
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
            >
              <option value="General">{dict.clarifications.general}</option>
              {problems.map((p) => (
                <option key={p.displayId} value={p.displayId}>
                  {formatMessage(dict.clarifications.problemNumber, { problem: p.displayId })}
                </option>
              ))}
            </select>
          </div>

          {/* Title Input */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
              {dict.clarifications.title}
            </label>
            <input
              name="title"
              required
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
              placeholder={dict.clarifications.questionTitlePlaceholder}
            />
          </div>
        </div>

        {/* Content Input */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
            {dict.clarifications.content}
          </label>
          <textarea
            name="content"
            required
            rows={5}
            className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
            placeholder={dict.clarifications.questionBodyPlaceholder}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-8 py-2.5 shadow-md transition-colors"
          >
            {dict.clarifications.submitQuestion}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ClarificationReplyForm({ contestId, clariId, isAdmin }: {
  contestId: string;
  clariId: string;
  isAdmin: boolean;
}) {
  const { dict } = useLanguage();

  async function handleReply(formData: FormData) {
    const result = await submitReply(formData);
    if (result?.error) {
      toast.error(dict.clarifications[result.error]);
    }
  }

  return (
    <div className="mt-10 pt-6 border-t border-gray-200">
      <h3 className="text-sm font-bold text-gray-500 uppercase mb-4">
        {dict.clarifications.reply}
      </h3>
      <form action={handleReply} className="p-2">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="clariId" value={clariId} />

        <div className="relative">
          <textarea
            name="content"
            required
            rows={4}
            className="w-full bg-white border border-gray-300 rounded-lg p-4 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none shadow-sm transition-all"
            aria-label={dict.clarifications.content}
            placeholder={isAdmin ? dict.clarifications.officialReplyPlaceholder : dict.clarifications.replyPlaceholder}
          />
          <div className="absolute bottom-3 right-3">
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-1.5 text-sm font-bold rounded hover:bg-blue-700 shadow-sm transition-colors cursor-pointer"
            >
              {dict.clarifications.replyButton}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
