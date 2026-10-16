"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AdminLoginModal from "./AdminLoginModal";
import PrintRequestModal from "./PrintRequestModal";
import { ContestRole } from "@/lib/generated/prisma/enums";
import {
  HomeIcon,
  LanguageIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { useLanguage } from "@/context/LanguageContext";

type DesktopNavItem =
  | {
      type: "link";
      key: string;
      href: string;
      label: string;
      className?: string;
    }
  | {
      type: "button";
      key: string;
      label: string;
      className?: string;
      onClick: () => void;
    };

export default function Navbar() {
  const [clickCount, setClickCount] = useState(0);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showPrintRequest, setShowPrintRequest] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [visibleDesktopItemCount, setVisibleDesktopItemCount] = useState(99);
  const [editorialContestId, setEditorialContestId] = useState<string | null>(
    null,
  );
  const desktopNavRef = useRef<HTMLDivElement>(null);
  const desktopMeasureRef = useRef<HTMLDivElement>(null);
  const desktopMoreMeasureRef = useRef<HTMLButtonElement>(null);

  // 新增：移动端侧边栏状态
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { user, logout, revalidate } = useAuth();
  const { dict, toggleLanguage, lang } = useLanguage();
  const isAdmin = user?.isGlobalAdmin;

  // 路由变化时，自动关闭移动端侧边栏
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // 处理登录回调
  useEffect(() => {
    if (searchParams.get("login") === "true") {
      revalidate?.();
    }
  }, [searchParams, revalidate]);

  // 处理点击外部关闭用户菜单
  useEffect(() => {
    const closeMenu = () => setShowUserMenu(false);
    if (showUserMenu) {
      document.addEventListener("click", closeMenu);
    }
    return () => document.removeEventListener("click", closeMenu);
  }, [showUserMenu]);

  useEffect(() => {
    const closeMenu = () => setShowMoreMenu(false);
    if (showMoreMenu) {
      document.addEventListener("click", closeMenu);
    }
    return () => document.removeEventListener("click", closeMenu);
  }, [showMoreMenu]);

  // 锁定侧边栏打开时的底层滚动
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isMobileMenuOpen]);

  const handleUserMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowUserMenu(!showUserMenu);
  };

  const handleMoreMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMoreMenu(!showMoreMenu);
  };

  const openMoreMenu = () => setShowMoreMenu(true);
  const closeMoreMenu = () => setShowMoreMenu(false);

  const match = pathname.match(/^\/contest\/(\d+)/);
  const contestId = match && !pathname.endsWith("/access") ? match[1] : null;
  const numericContestId = contestId ? Number(contestId) : null;

  const getContestLink = useCallback(
    (subPath: string) => `/contest/${contestId}${subPath}`,
    [contestId],
  );

  useEffect(() => {
    let ignore = false;

    if (!contestId) return;

    fetch(`/api/contests/${contestId}/editorial/meta`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { available: false }))
      .then((data) => {
        if (!ignore) setEditorialContestId(data.available ? contestId : null);
      })
      .catch(() => {
        if (!ignore) setEditorialContestId(null);
      });

    return () => {
      ignore = true;
    };
  }, [contestId]);

  const hasEditorial = editorialContestId === contestId;

  const isActive = (path: string) => {
    if (path === `/contest/${contestId}`) {
      return pathname === `/contest/${contestId}`;
    }
    if (pathname === path) return true;
    return pathname.startsWith(path + "/");
  };

  // 桌面端链接样式
  const desktopLinkClass = (path: string, extraClass: string = "") =>
    `px-3 py-2 font-bold transition-colors whitespace-nowrap hidden md:block ${
      isActive(path) ? "text-blue-700" : "text-gray-900 hover:text-blue-700"
    } ${extraClass}`;

  const desktopMenuLinkClass = (path: string, extraClass: string = "") =>
    `block w-full px-4 py-2 text-left text-sm font-bold transition-colors ${
      isActive(path)
        ? "bg-blue-50 text-blue-700"
        : "text-gray-700 hover:bg-gray-50 hover:text-blue-700"
    } ${extraClass}`;

  const desktopButtonClass = (extraClass: string = "") =>
    `px-3 py-2 font-bold transition-colors whitespace-nowrap hidden md:block cursor-pointer ${extraClass}`;

  const desktopMenuButtonClass = (extraClass: string = "") =>
    `block w-full px-4 py-2 text-left text-sm font-bold transition-colors hover:bg-gray-50 cursor-pointer ${extraClass}`;

  // 移动端侧边栏链接样式
  const mobileLinkClass = (path: string, extraClass: string = "") =>
    `block px-4 py-4 text-lg font-bold border-b border-gray-100 transition-colors ${
      isActive(path)
        ? "text-blue-700 bg-blue-50"
        : "text-gray-900 active:bg-gray-50"
    } ${extraClass}`;

  useEffect(() => {
    if (clickCount === 0) return;
    const timer = setTimeout(() => setClickCount(0), 2000);
    return () => clearTimeout(timer);
  }, [clickCount]);

  const handleNavClick = (e: React.MouseEvent) => {
    if (user) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "NAV" ||
      target?.className?.includes("max-w-7xl") ||
      target?.className?.includes("nav-trigger")
    ) {
      const newCount = clickCount + 1;
      setClickCount(newCount);
      if (newCount === 3) {
        setShowAdminLogin(true);
        setClickCount(0);
      }
    }
  };

  const isSameContestUser =
    !!numericContestId && user?.contestId === numericContestId;
  const isBalloonStaff =
    isAdmin ||
    (isSameContestUser &&
      (user?.role === ContestRole.ADMIN ||
        user?.role === ContestRole.JUDGE ||
        user?.role === ContestRole.BALLOON));
  const isPrintStaff =
    isAdmin ||
    (isSameContestUser &&
      (user?.role === ContestRole.ADMIN ||
        user?.role === ContestRole.JUDGE ||
        user?.role === ContestRole.PRINT));
  const canRequestPrint = isSameContestUser && user?.role === ContestRole.TEAM;

  const desktopContestItems = useMemo<DesktopNavItem[]>(() => {
    if (!contestId) return [];

    const items: DesktopNavItem[] = [
      {
        type: "link",
        key: "contest",
        href: getContestLink(""),
        label: dict.nav.contest,
      },
      {
        type: "link",
        key: "problems",
        href: getContestLink("/problems"),
        label: dict.nav.problems,
      },
      {
        type: "link",
        key: "status",
        href: getContestLink("/status"),
        label: dict.nav.status,
      },
      {
        type: "link",
        key: "rank",
        href: getContestLink("/rank"),
        label: dict.nav.rank,
      },
      {
        type: "link",
        key: "clarifications",
        href: getContestLink("/clarifications"),
        label: dict.nav.clarifications,
      },
    ];

    if (canRequestPrint) {
      items.push({
        type: "button",
        key: "print-request",
        label: dict.nav.print,
        className: "text-slate-700 hover:text-slate-900",
        onClick: () => setShowPrintRequest(true),
      });
    }

    if (hasEditorial) {
      items.push({
        type: "link",
        key: "editorial",
        href: getContestLink("/editorial"),
        label: dict.nav.editorial,
        className: "text-red-600 hover:text-red-800",
      });
    }

    if (isBalloonStaff) {
      items.push({
        type: "link",
        key: "balloon",
        href: getContestLink("/balloon"),
        label: dict.nav.balloon,
        className: "text-orange-600 hover:text-orange-800",
      });
    }

    if (isPrintStaff) {
      items.push({
        type: "link",
        key: "print-queue",
        href: getContestLink("/print"),
        label: dict.nav.printQueue,
        className: "text-slate-700 hover:text-slate-900",
      });
    }

    if (isAdmin) {
      items.push({
        type: "link",
        key: "admin",
        href: "/admin",
        label: dict.nav.adminPanel,
        className: "text-red-600 hover:text-red-800",
      });
    }

    return items;
  }, [
    canRequestPrint,
    contestId,
    dict.nav.adminPanel,
    dict.nav.balloon,
    dict.nav.clarifications,
    dict.nav.contest,
    dict.nav.editorial,
    dict.nav.print,
    dict.nav.printQueue,
    dict.nav.problems,
    dict.nav.rank,
    dict.nav.status,
    hasEditorial,
    getContestLink,
    isAdmin,
    isBalloonStaff,
    isPrintStaff,
  ]);

  const measureDesktopNav = useCallback(() => {
    const nav = desktopNavRef.current;
    const measure = desktopMeasureRef.current;
    if (!nav || !measure) return;

    const itemWidths = Array.from(measure.children).map(
      (child) => (child as HTMLElement).offsetWidth,
    );
    const availableWidth = nav.clientWidth;
    const totalWidth = itemWidths.reduce((sum, width) => sum + width, 0);

    if (totalWidth <= availableWidth) {
      setVisibleDesktopItemCount(itemWidths.length);
      return;
    }

    const moreWidth = desktopMoreMeasureRef.current?.offsetWidth || 76;
    let usedWidth = moreWidth;
    let nextVisibleCount = 0;

    for (const width of itemWidths) {
      if (usedWidth + width > availableWidth) break;
      usedWidth += width;
      nextVisibleCount += 1;
    }

    setVisibleDesktopItemCount(nextVisibleCount);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(measureDesktopNav);
    const nav = desktopNavRef.current;
    if (!nav) return () => cancelAnimationFrame(frame);

    const observer = new ResizeObserver(measureDesktopNav);
    observer.observe(nav);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [desktopContestItems, measureDesktopNav]);

  const visibleDesktopItems = desktopContestItems.slice(
    0,
    visibleDesktopItemCount,
  );
  const overflowDesktopItems = desktopContestItems.slice(
    visibleDesktopItemCount,
  );

  const renderDesktopItem = (item: DesktopNavItem) => {
    if (item.type === "link") {
      return (
        <Link
          key={item.key}
          href={item.href}
          className={desktopLinkClass(item.href, item.className)}
        >
          {item.label}
        </Link>
      );
    }

    return (
      <button
        key={item.key}
        type="button"
        onClick={item.onClick}
        className={desktopButtonClass(item.className)}
      >
        {item.label}
      </button>
    );
  };

  const renderDesktopMenuItem = (item: DesktopNavItem) => {
    if (item.type === "link") {
      return (
        <Link
          key={item.key}
          href={item.href}
          className={desktopMenuLinkClass(item.href, item.className)}
          onClick={() => setShowMoreMenu(false)}
        >
          {item.label}
        </Link>
      );
    }

    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          item.onClick();
          setShowMoreMenu(false);
        }}
        className={desktopMenuButtonClass(
          item.className || "text-gray-700 hover:text-blue-700",
        )}
      >
        {item.label}
      </button>
    );
  };

  return (
    <>
      <nav
        onClick={handleNavClick}
        className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 nav-trigger">
          <div className="flex justify-between items-center h-14 font-serif text-xl nav-trigger gap-3">
            {/* 左侧：移动端汉堡菜单按钮 & 桌面端导航 */}
            <div className="flex min-w-0 flex-1 items-center">
              {/* 移动端汉堡菜单按钮 */}
              <button
                className="md:hidden mr-2 p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-md"
                onClick={() => setIsMobileMenuOpen(true)}
              >
                <Bars3Icon className="w-6 h-6" />
              </button>

              <Link
                href="/"
                className="text-gray-900 font-bold px-2 py-2 shrink-0 flex items-center gap-1"
              >
                <HomeIcon className="w-6 h-6 md:hidden" />
                <span className="hidden md:block">{dict.nav.home}</span>
              </Link>

              {/* ================= 桌面端导航项 (移动端隐藏) ================= */}
              <div className="hidden md:flex min-w-0 flex-1 items-center">
                {user && !user.contestId && (
                  <Link href="/train" className={desktopLinkClass("/train")}>
                    训练中心
                  </Link>
                )}

                {contestId && (
                  <>
                    <span className="text-gray-300 shrink-0 mx-1">|</span>
                    <div className="pointer-events-none absolute left-0 top-0 -z-10 flex opacity-0">
                      <div ref={desktopMeasureRef} className="flex items-center">
                        {desktopContestItems.map(renderDesktopItem)}
                      </div>
                      <button
                        ref={desktopMoreMeasureRef}
                        type="button"
                        className="px-3 py-2 font-bold whitespace-nowrap flex items-center gap-1"
                      >
                        More
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <div
                      ref={desktopNavRef}
                      className="relative flex min-w-0 flex-1 items-center"
                    >
                      {visibleDesktopItems.map(renderDesktopItem)}

                      {overflowDesktopItems.length > 0 && (
                        <div
                          className="relative hidden md:block"
                          onMouseEnter={openMoreMenu}
                          onMouseLeave={closeMoreMenu}
                        >
                          <button
                            type="button"
                            onClick={handleMoreMenuClick}
                            className={`px-3 py-2 font-bold transition-colors whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                              showMoreMenu
                                ? "text-blue-700"
                                : "text-gray-900 hover:text-blue-700"
                            }`}
                          >
                            More
                            <ChevronDownIcon
                              className={`h-4 w-4 transition-transform ${
                                showMoreMenu ? "rotate-180" : ""
                              }`}
                            />
                          </button>

                          {showMoreMenu && (
                            <div
                              className="absolute left-0 top-full z-50 w-48 pt-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="overflow-hidden rounded-sm border border-gray-200 bg-white py-1 shadow-lg">
                                {overflowDesktopItems.map(
                                  renderDesktopMenuItem,
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {isAdmin && !contestId && (
                  <>
                    <span className="text-gray-300 shrink-0 mx-1">|</span>
                    <Link
                      href="/admin"
                      className="text-red-600 hover:text-red-800 px-3 py-2 text-xl font-bold flex items-center shrink-0"
                    >
                      {dict.nav.adminPanel}
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* 右侧：用户菜单与多语言 (始终在顶部显示) */}
            <div className="flex space-x-4 text-lg items-center gap-2 sm:gap-4 shrink-0">
              <button
                onClick={toggleLanguage}
                className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-100 cursor-pointer"
                title="Switch Language"
              >
                <div className="flex items-center text-sm font-bold gap-1">
                  <LanguageIcon className="w-5 h-5" />
                  <span>{lang === "zh" ? "中" : "EN"}</span>
                </div>
              </button>

              {user ? (
                <div className="relative">
                  <button
                    onClick={handleUserMenuClick}
                    className="text-gray-700 font-bold flex items-center gap-1 max-w-30 sm:max-w-none truncate focus:outline-none cursor-pointer"
                  >
                    {user.isGlobalAdmin && (
                      <span className="text-red-600 hidden sm:inline">
                        [{dict.nav.superAdmin}]
                      </span>
                    )}
                    <span className="truncate">{user.username}</span>
                    <span
                      className="text-xs transition-transform duration-200"
                      style={{
                        transform: showUserMenu
                          ? "rotate(180deg)"
                          : "rotate(0)",
                      }}
                    >
                      ▼
                    </span>
                  </button>

                  {showUserMenu && (
                    <div className="absolute right-0 top-full mt-2 w-32 bg-white border border-gray-200 shadow-lg rounded-sm z-50">
                      <button
                        onClick={logout}
                        className="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer active:bg-gray-200"
                      >
                        {dict.nav.logout}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 md:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <div
        className={`fixed top-0 left-0 bottom-0 w-64 bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out md:hidden flex flex-col ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-100">
          <span className="font-bold text-xl font-serif">NovaJudge</span>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <Link href="/" className={mobileLinkClass("/")}>
            {dict.nav.home}
          </Link>

          {user && !user.contestId && (
            <Link href="/train" className={mobileLinkClass("/train")}>
              {dict.nav.train}
            </Link>
          )}

          {contestId && (
            <>
              <div className="px-4 py-2 mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                {dict.nav.contestMenu}
              </div>
              <Link
                href={getContestLink("")}
                className={mobileLinkClass(`/contest/${contestId}`)}
              >
                {dict.nav.contest}
              </Link>
              <Link
                href={getContestLink("/problems")}
                className={mobileLinkClass(`/contest/${contestId}/problems`)}
              >
                {dict.nav.problems}
              </Link>
              <Link
                href={getContestLink("/status")}
                className={mobileLinkClass(`/contest/${contestId}/status`)}
              >
                {dict.nav.status}
              </Link>
              <Link
                href={getContestLink("/rank")}
                className={mobileLinkClass(`/contest/${contestId}/rank`)}
              >
                {dict.nav.rank}
              </Link>
              <Link
                href={getContestLink("/clarifications")}
                className={mobileLinkClass(
                  `/contest/${contestId}/clarifications`,
                )}
              >
                {dict.nav.clarifications}
              </Link>
              {hasEditorial && (
                <Link
                  href={getContestLink("/editorial")}
                  className={mobileLinkClass(
                    `/contest/${contestId}/editorial`,
                    "text-red-600",
                  )}
                >
                  {dict.nav.editorial}
                </Link>
              )}
              {canRequestPrint && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPrintRequest(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="block px-4 py-4 text-lg font-bold border-b border-gray-100 transition-colors text-slate-700 text-left w-full cursor-pointer active:bg-gray-50"
                >
                  {dict.nav.print}
                </button>
              )}
            </>
          )}

          {contestId && (isBalloonStaff || isPrintStaff) && (
            <>
              {isBalloonStaff && (
                <Link
                  href={getContestLink("/balloon")}
                  className={mobileLinkClass(
                    `/contest/${contestId}/balloon`,
                    "text-orange-600",
                  )}
                >
                  🎈 {dict.nav.balloon}
                </Link>
              )}
              {isPrintStaff && (
                <Link
                  href={getContestLink("/print")}
                  className={mobileLinkClass(
                    `/contest/${contestId}/print`,
                    "text-slate-700",
                  )}
                >
                  {dict.nav.printQueue}
                </Link>
              )}
            </>
          )}

          {isAdmin && (
            <>
              <div className="px-4 py-2 mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                {dict.nav.adminMenu}
              </div>
              <Link
                href="/admin"
                className={mobileLinkClass("/admin", "text-red-600")}
              >
                {dict.nav.adminPanel}
              </Link>
            </>
          )}
        </div>
      </div>

      {showAdminLogin && (
        <AdminLoginModal onClose={() => setShowAdminLogin(false)} />
      )}
      {showPrintRequest && numericContestId && (
        <PrintRequestModal
          contestId={numericContestId}
          onClose={() => setShowPrintRequest(false)}
        />
      )}
    </>
  );
}
