import type { Metadata } from "next";
import CliInstructions from "./client";
import { isCliEnabled } from "@/lib/cli-deployment";
import { notFound } from "next/navigation";
import { getLanguage } from "@/lib/get-dictionary";
import { cliInstructions } from "./messages";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = cliInstructions[await getLanguage()];
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

export default function CliPage() {
  if (!isCliEnabled()) notFound();
  return <CliInstructions />;
}
