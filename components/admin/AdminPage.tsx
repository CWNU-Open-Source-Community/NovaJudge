import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { createAdminLocale } from "@/lib/admin-locale";

export function AdminPageHeader({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1 basis-56">
        {back && (
          <Link href={back.href} className="admin-text-link mb-3 inline-flex items-center gap-1.5 text-sm">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h1 className="wrap-break-word text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-gray-600">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function AdminTable({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className={`admin-table ${className}`}>{children}</table>
    </div>
  );
}

export function AdminContestStatus({ status, lang }: { status: string; lang: "zh" | "en" }) {
  const { t } = createAdminLocale(lang);
  const label = status === "RUNNING" ? t("Running", "进行中") : status === "ENDED" ? t("Ended", "已结束") : t("Pending", "未开始");
  const color = status === "RUNNING" ? "bg-green-100 text-green-700" : status === "ENDED" ? "bg-gray-100 text-gray-700" : "bg-yellow-50 text-yellow-700";
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ${color}`}>{label}</span>;
}
