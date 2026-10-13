"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  HomeIcon,
  TrophyIcon,
  ArchiveBoxIcon,
  ArrowRightOnRectangleIcon,
  GlobeAltIcon, // [新增] 用于表示前台/网站的图标
  ChartBarIcon,
  KeyIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";

const MENU_ITEMS = [
  { name: "Dashboard", href: "/admin", icon: HomeIcon },
  { name: "Monitor", href: "/admin/monitor", icon: SignalIcon },
  { name: "Contest Management", href: "/admin/contests", icon: TrophyIcon },
  { name: "Problem Bank", href: "/admin/problems", icon: ArchiveBoxIcon },
  { name: "Submissions", href: "/admin/submissions", icon: ChartBarIcon },
  { name: "API Keys", href: "/admin/api-keys", icon: KeyIcon },
  { name: "Training", href: "/admin/training", icon: ArchiveBoxIcon },
  { name: "Settings", href: "/admin/settings", icon: GlobeAltIcon },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed. Please retry.");
      window.location.assign("/");
    } catch {
      setSignOutError("Sign out failed. Please retry.");
      setSigningOut(false);
    }
  }
  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shrink-0 fixed h-full z-10">
        {/* 1. 顶部标题区域 */}
        <div className="h-16 flex items-center justify-center font-bold text-xl border-b border-slate-700 bg-slate-950">
          NovaJudge Admin
        </div>

        {/* 2. 菜单导航区域 */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {/* 返回前台首页的按钮 */}
          <Link
            href="/"
            className="flex items-center px-4 py-3 text-sm font-medium rounded-md text-blue-300 hover:bg-slate-800 hover:text-white transition-colors mb-4 border border-slate-700/50 bg-slate-800/30"
          >
            <GlobeAltIcon className="mr-3 h-5 w-5" />
            Back to Home
          </Link>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 mb-2 mt-2">
            Management
          </div>

          {MENU_ITEMS.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`group flex items-center px-4 py-3 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white shadow-md" // 激活样式：蓝色背景、白色文字
                    : "text-slate-300 hover:bg-slate-800 hover:text-white" // 普通样式
                }`}
              >
                <item.icon
                  className={`mr-3 h-5 w-5 transition-colors ${
                    isActive
                      ? "text-white" // 激活时图标白色
                      : "text-slate-400 group-hover:text-white" // 普通时灰色，悬停变白
                  }`}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* 3. 底部操作区域 */}
        <div className="p-4 border-t border-slate-700 bg-slate-900">
          <button onClick={signOut} disabled={signingOut} className="flex items-center w-full px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50">
            <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5" />
            {signingOut ? "Signing Out..." : "Sign Out"}
          </button>
          {signOutError && <p role="alert" className="text-sm text-red-300 mt-2">{signOutError}</p>}
        </div>
      </aside>

      {/* Main Content */}
      {/* min-w-0：允许内容区收缩到可用宽度（侧边栏 fixed + ml-64），
          避免宽内容（如表格）把页面整体撑出视口右侧 */}
      <main className="flex-1 min-w-0 ml-64 p-0 bg-gray-50">
        <div className="p-8 h-full overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
