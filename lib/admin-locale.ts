export function createAdminLocale(lang: "zh" | "en") {
  return {
    lang,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    t: (english: string, chinese: string) => lang === "zh" ? chinese : english,
  };
}
