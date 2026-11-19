"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { en, zh, getLocale, type Dictionary, type Language } from "@/lib/dictionaries";
import { useRouter } from "next/navigation";

interface LanguageContextType {
  lang: Language;
  dict: Dictionary;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

// 简单的 Cookie 操作辅助函数
function setCookie(name: string, value: string, days: number) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
  return null;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>("zh"); // 默认中文
  const router = useRouter();
  useEffect(() => {
    // 初始化时优先读 Cookie
    const saved = getCookie("app-lang");
    if (saved === "en" || saved === "zh") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLang(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = getLocale(lang);
  }, [lang]);

  const toggleLanguage = () => {
    const newLang = lang === "zh" ? "en" : "zh";
    setLang(newLang);

    // 1. 写入 Cookie
    setCookie("app-lang", newLang, 365);

    // 2. 刷新页面数据 (Server Components 会重新运行并读取新 Cookie)
    router.refresh();
  };

  const dict = lang === "zh" ? zh : en;

  // 解决 Hydration Mismatch: 只有在客户端加载完成后才渲染子组件，
  // 或者你也可以接受服务端渲染默认语言(zh)带来的瞬间闪烁，去掉这个 mount 逻辑
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="min-h-screen bg-gray-50" />; // 或者返回 null
  }

  return (
    <LanguageContext.Provider value={{ lang, dict, toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
