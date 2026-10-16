"use client";

import { useActionState } from "react";
import { unlockContest } from "./actions";

export default function AccessForm({ contestId }: { contestId: number }) {
  const [state, action, pending] = useActionState(
    unlockContest.bind(null, contestId),
    { error: "" },
  );
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="contest-password" className="mb-2 block text-sm font-medium text-gray-700">
          比赛密码
        </label>
        <input
          id="contest-password"
          name="password"
          type="password"
          autoComplete="off"
          required
          autoFocus
          aria-describedby={state.error ? "contest-access-error" : undefined}
          aria-invalid={!!state.error}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>
      {state.error && (
        <p id="contest-access-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
        {pending ? "正在验证…" : "验证并进入比赛"}
      </button>
    </form>
  );
}
