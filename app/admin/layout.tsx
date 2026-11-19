"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  ArchiveBoxIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  BuildingOffice2Icon,
  ChartBarIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  GlobeAltIcon,
  HomeIcon,
  KeyIcon,
  LanguageIcon,
  RectangleStackIcon,
  SignalIcon,
  TrophyIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import "./admin.css";

const sections = [
  {
    en: "Overview",
    zh: "概览",
    items: [
      { en: "Dashboard", zh: "仪表盘", href: "/admin", icon: HomeIcon },
      { en: "Judge Monitor", zh: "判题监控", href: "/admin/judge-monitor", icon: SignalIcon },
    ],
  },
  {
    en: "Management",
    zh: "赛事管理",
    items: [
      { en: "Contests", zh: "比赛管理", href: "/admin/contests", icon: TrophyIcon },
      { en: "Problem Bank", zh: "题库", href: "/admin/problems", icon: ArchiveBoxIcon },
      { en: "Submissions", zh: "提交记录", href: "/admin/submissions", icon: ChartBarIcon },
      { en: "Training", zh: "训练中心", href: "/admin/training", icon: RectangleStackIcon },
    ],
  },
  {
    en: "Configuration",
    zh: "站点配置",
    items: [
      { en: "External Accounts", zh: "外部账号", href: "/admin/accounts", icon: UserGroupIcon },
      { en: "Organizations", zh: "组织管理", href: "/admin/organizations", icon: BuildingOffice2Icon },
      { en: "API Keys", zh: "API 密钥", href: "/admin/api-keys", icon: KeyIcon },
      { en: "Settings", zh: "系统设置", href: "/admin/settings", icon: Cog6ToothIcon },
    ],
  },
];

const menuItems = sections.flatMap((section) => section.items);

function AdminNavigation({
  activeHref,
  pathname,
  onClose,
  onSignOut,
  signingOut,
  signOutError,
}: {
  activeHref?: string;
  pathname: string;
  onClose?: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: boolean;
}) {
  const { t } = useAdminLocale();

  return (
    <>
      <div className="flex h-17 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-4">
        <Link href="/admin" onClick={onClose} className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-blue-300">
            <CommandLineIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-white">NovaJudge</span>
            <span className="block text-xs text-slate-400">{t("Administration", "管理后台")}</span>
          </span>
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("Close menu", "关闭菜单")} className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-400">
            <XMarkIcon className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <nav aria-label={t("Administration", "后台导航")} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.en}>
            <p className="mb-1.5 px-2.5 text-xs font-medium text-slate-400">{t(section.en, section.zh)}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={item.href === pathname ? "page" : item.href === activeHref ? "location" : undefined}
                    className={`group flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 `+(
                      activeHref === item.href ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    <item.icon className={`size-[18px] shrink-0 `+(activeHref === item.href ? "text-white" : "text-slate-400 group-hover:text-white")} aria-hidden="true" />
                    {t(item.en, item.zh)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-slate-800 p-3">
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/20 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-red-400 disabled:cursor-wait disabled:opacity-50"
        >
          <ArrowRightOnRectangleIcon className="size-[18px] shrink-0" aria-hidden="true" />
          {signingOut ? t("Signing out…", "正在退出…") : t("Sign out", "退出登录")}
        </button>
        {signOutError && <p role="alert" className="mt-2 px-2.5 text-xs text-red-300">{t("Sign out failed. Please retry.", "退出失败，请重试。")}</p>}
      </div>
    </>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, locale, toggleLanguage } = useAdminLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const activeItem = menuItems.find(({ href }) => pathname === href || (href !== "/admin" && pathname.startsWith(href + "/")));

  useEffect(() => {
    if (!menuOpen) return;
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign("/");
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  }

  const navigationProps = { pathname, activeHref: activeItem?.href, signingOut, signOutError, onSignOut: signOut };

  return (
    <div lang={locale} className="admin-ui min-h-dvh bg-gray-50 text-gray-900 lg:flex">
      <a href="#admin-content" className="sr-only rounded-lg bg-white px-4 py-2 text-blue-700 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        {t("Skip to content", "跳到内容")}
      </a>
      <aside className="hidden h-dvh w-60 shrink-0 flex-col bg-slate-900 text-white lg:sticky lg:top-0 lg:flex">
        <AdminNavigation {...navigationProps} />
      </aside>

      <Dialog open={menuOpen} onClose={setMenuOpen} lang={locale} className="fixed inset-0 z-50 font-sans lg:hidden">
        <DialogBackdrop transition className="fixed inset-0 bg-slate-950/55 motion-safe:transition-opacity data-closed:opacity-0" />
        <DialogPanel transition className="fixed inset-y-0 left-0 flex w-[min(19rem,calc(100vw_-_2.5rem))] flex-col bg-slate-900 text-white shadow-xl motion-safe:transition-transform data-closed:-translate-x-full">
          <DialogTitle className="sr-only">{t("Administration menu", "后台导航菜单")}</DialogTitle>
          <AdminNavigation {...navigationProps} onClose={() => setMenuOpen(false)} />
        </DialogPanel>
      </Dialog>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 border-b border-gray-200 bg-white">
          <div className="mx-auto flex h-16 max-w-400 items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button type="button" className="admin-icon-button size-10 lg:hidden" onClick={() => setMenuOpen(true)} aria-label={t("Open menu", "打开菜单")} aria-haspopup="dialog" aria-expanded={menuOpen}>
                <Bars3Icon className="size-5" aria-hidden="true" />
              </button>
              <nav aria-label={t("Breadcrumb", "当前位置")} className="flex min-w-0 items-center gap-2 text-sm">
                <Link href="/admin" className="shrink-0 rounded-sm text-gray-600 hover:text-blue-700">{t("Admin", "后台")}</Link>
                {activeItem && (
                  <>
                    <ChevronRightIcon className="size-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                    <span className="truncate font-semibold text-gray-900">{t(activeItem.en, activeItem.zh)}</span>
                  </>
                )}
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <button type="button" onClick={toggleLanguage} className="admin-button px-2.5 sm:px-3.5" aria-label={t("Switch to Chinese", "切换到英文")}>
                <LanguageIcon className="size-4 shrink-0" aria-hidden="true" />
                {t("中文", "English")}
              </button>
              <Link href="/" className="admin-icon-button sm:gap-2 sm:w-auto sm:px-2.5 sm:text-sm" aria-label={t("View site", "返回前台")} title={t("View site", "返回前台")}>
                <GlobeAltIcon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{t("View site", "返回前台")}</span>
              </Link>
            </div>
          </div>
        </div>
        <main id="admin-content" tabIndex={-1} className="mx-auto max-w-400 scroll-mt-16 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
