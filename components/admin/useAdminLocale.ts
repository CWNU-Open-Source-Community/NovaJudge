"use client";

import { useLanguage } from "@/context/LanguageContext";
import { createAdminLocale } from "@/lib/admin-locale";

const locales = {
  zh: createAdminLocale("zh"),
  en: createAdminLocale("en"),
};

export function useAdminLocale() {
  const { lang, toggleLanguage } = useLanguage();
  return { ...locales[lang], toggleLanguage };
}
