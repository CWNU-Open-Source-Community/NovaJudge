import type { Metadata } from "next";
import DeviceApproval from "./client";

export const metadata: Metadata = {
  title: "绑定 submit 命令行",
  robots: { index: false, follow: false },
};

export default async function CliConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const userCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  return <DeviceApproval key={userCode} code={userCode} />;
}
