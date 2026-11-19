"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

export default function AdminLoginModal({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const { dict } = useLanguage();
  const { auth } = dict;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<keyof typeof auth | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, isGlobalAdmin: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.user) {
        if (data?.error === "Account has been banned") setError("accountBanned");
        else setError(res.status === 401 ? "invalidCredentials" : "signInFailed");
        return;
      }
      login(data.user);
      onClose();
    } catch {
      setError("networkError");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 border-t-4 border-red-600 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">
            {auth.superAdminAccess}
          </h2>
          <button
            onClick={onClose}
            aria-label={dict.common.close}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4 border border-red-100">
            {auth[error]}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-login-username" className="block text-sm font-medium text-gray-700 mb-1">
              {auth.username}
            </label>
            <input
              id="admin-login-username"
              type="text"
              className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-red-500 outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="admin-login-password" className="block text-sm font-medium text-gray-700 mb-1">
              {auth.password}
            </label>
            <input
              id="admin-login-password"
              type="password"
              className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-red-500 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="w-full bg-red-600 text-white py-2 rounded hover:bg-red-700 font-bold transition-colors"
          >
            {auth.signIn}
          </button>
        </form>
      </div>
    </div>
  );
}
