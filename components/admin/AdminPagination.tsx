"use client";

import Pagination from "@/components/Pagination";
import { useAdminLocale } from "./useAdminLocale";

export default function AdminPagination({ totalItems, pageSize }: { totalItems: number; pageSize?: number }) {
  const { t, locale } = useAdminLocale();
  const count = totalItems.toLocaleString(locale);

  return <Pagination totalItems={totalItems} pageSize={pageSize} labels={{
    navigation: t("Pagination", "分页"),
    previous: t("Previous page", "上一页"),
    next: t("Next page", "下一页"),
    total: t(`${count} total`, `共 ${count} 条`),
  }} />;
}
