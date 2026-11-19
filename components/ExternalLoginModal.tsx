"use client";

import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

export default function ExternalLoginModal({
  providerLabel = "",
  providerUrl = "",
  onClose,
  onSuccess,
}: {
  providerLabel?: string;
  providerUrl?: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { dict } = useLanguage();
  const { auth } = dict;
  const [providerPrefix, providerSuffix] = auth.externalWithProvider.split("{provider}");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<keyof typeof auth | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("missingCredentials");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/external/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.error === "Account has been banned") setError("accountBanned");
        else if (data?.error === "External login is disabled") setError("externalDisabled");
        else setError(res.status === 401 ? "invalidCredentials" : "signInFailed");
        setSubmitting(false);
        return;
      }
      onSuccess?.();
      onClose();
    } catch {
      setError("networkError");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm rounded-sm shadow-lg border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-gray-900">{dict.nav.externalLogin}</h3>
          <p className="text-xs text-gray-500">
            {providerLabel ? (
              <>
                {providerPrefix}
                {providerUrl ? (
                  <a
                    className="text-blue-600 hover:underline"
                    href={providerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {providerLabel}
                  </a>
                ) : (
                  <span className="font-medium text-gray-700">
                    {providerLabel}
                  </span>
                )}
                {providerSuffix}
              </>
            ) : (
              auth.externalDescription
            )}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="external-login-username" className="block text-sm font-bold text-gray-700 mb-2">
              {auth.username}
            </label>
            <input
              id="external-login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              placeholder={auth.usernamePlaceholder}
            />
          </div>
          <div>
            <label htmlFor="external-login-password" className="block text-sm font-bold text-gray-700 mb-2">
              {auth.password}
            </label>
            <input
              id="external-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              placeholder={auth.passwordPlaceholder}
            />
          </div>
          {error && <div className="text-red-600 text-xs">{auth[error]}</div>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-sm text-sm px-5 py-2.5 shadow-md disabled:opacity-60 cursor-pointer"
            >
              {submitting ? auth.signingIn : auth.signIn}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium rounded-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {dict.common.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
