"use client";

import { useState } from "react";

export default function ExternalLoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/external/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const t = await res.text();
        setError(t || "登录失败");
        setSubmitting(false);
        return;
      }
      onSuccess?.();
      onClose();
    } catch {
      setError("网络错误，请稍后重试");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm rounded-sm shadow-lg border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-gray-900">外部登录</h3>
          <p className="text-xs text-gray-500">
            使用
            <a
              className=" text-blue-600"
              href="https://www.cwnupaa.com/"
              target="_black"
            >
              程序设计算法协会官网
            </a>
            的账号密码登录
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              placeholder="请输入用户名"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-blue-50/30 border border-blue-200 text-gray-900 text-sm rounded-sm focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              placeholder="请输入密码"
            />
          </div>
          {error && <div className="text-red-600 text-xs">{error}</div>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-sm text-sm px-5 py-2.5 shadow-md disabled:opacity-60 cursor-pointer"
            >
              {submitting ? "登录中…" : "登录"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium rounded-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
