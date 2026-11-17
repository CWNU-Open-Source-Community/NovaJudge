import { redirect } from "next/navigation";

// Preserve bookmarks to the public edition's judge monitor.
export default function MonitorRedirect() {
  redirect("/admin/judge-monitor");
}
