import { AdminPageHeader } from "@/components/admin/AdminPage";
import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import EditForm from "./EditForm";

export interface ContestConfig {
  frozenDuration?: number;
  unfreezeDelay?: number;
  editorialPdf?: {
    filename: string;
    uploadedAt: string;
  };
  medal?: {
    mode: "ratio" | "fixed";
    gold: number;
    silver: number;
    bronze: number;
  };
}

export interface Contest {
  id: number;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  type: string;
  password: string | null;
  visible: boolean;
  config: ContestConfig; // Prisma Json
}

export default async function EditContestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contestId = Number(id);

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
  });

  const { t } = createAdminLocale(await getLanguage());
  if (!contest) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <AdminPageHeader title={t("Edit contest", "编辑比赛")} description={contest.title + " · #" + contest.id} back={{ href: "/admin/contests", label: t("Back to contests", "返回比赛管理") }} />

      <EditForm contest={contest as unknown as Contest} />
    </div>
  );
}
