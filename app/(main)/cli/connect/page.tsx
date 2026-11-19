import type { Metadata } from "next";
import DeviceApproval from "./client";
import { isCliEnabled } from "@/lib/cli-deployment";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/get-dictionary";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { cliConnect } = await getDictionary();
  return { title: cliConnect.title, robots: { index: false, follow: false } };
}

export default async function CliConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  if (!isCliEnabled()) notFound();
  const { code } = await searchParams;
  const userCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  return <DeviceApproval key={userCode} code={userCode} />;
}
