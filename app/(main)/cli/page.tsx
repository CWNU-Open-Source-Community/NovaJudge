import type { Metadata } from "next";
import CliInstructions from "./client";
import { isCliEnabled } from "@/lib/cli-deployment";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "submit 命令行安装",
  description: "在 Windows 或 macOS 上安装 NovaJudge submit 命令，直接从终端提交比赛代码。",
};

export default function CliPage() {
  if (!isCliEnabled()) notFound();
  return <CliInstructions />;
}
