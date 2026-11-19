import "server-only"; // 确保此文件只在服务端通过
import { cookies } from "next/headers";
import { en, zh } from "./dictionaries";

// 这是一个异步函数，专门给 Server Component 用
export async function getLanguage() {
  const cookieStore = await cookies();
  return cookieStore.get("app-lang")?.value === "en" ? "en" : "zh";
}

export async function getDictionary() {
  return (await getLanguage()) === "en" ? en : zh;
}
