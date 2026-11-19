"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";
import OrganizationLogo from "@/components/OrganizationLogo";
import { organizationLogoUrl, type OrganizationEntry, type OrganizationErrorCode } from "@/lib/organizations";
import { deleteOrganization, saveOrganization } from "./actions";

type Editor = { entry: OrganizationEntry | null };
type Result = { error: OrganizationErrorCode | null };

function EditorForm({ entry, schools, pending, onSave, onClose }: Editor & {
  schools: string[]; pending: boolean; onSave: (form: FormData) => void; onClose: () => void;
}) {
  const { t } = useAdminLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [remove, setRemove] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const image = preview || (!remove && entry?.logoHash ? organizationLogoUrl(entry.logoHash) : "");

  return <Dialog open onClose={() => { if (!pending) onClose(); }} className="admin-ui relative z-50">
    <DialogBackdrop className="fixed inset-0 bg-slate-950/50" />
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-3 sm:p-5">
      <DialogPanel className="w-full max-w-lg max-h-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <DialogTitle className="text-lg font-semibold">{entry ? t("Edit organization", "编辑组织") : t("Add organization", "新增组织")}</DialogTitle>
          <button type="button" className="admin-icon-button" disabled={pending} aria-label={t("Close", "关闭")} onClick={onClose}><XMarkIcon className="size-5" /></button>
        </div>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (!fileInput.current?.files?.length) form.delete("logo");
          onSave(form);
        }}>
          {entry && <><input type="hidden" name="key" value={entry.key} /><input type="hidden" name="version" value={entry.version} /></>}
          <label className="block text-sm font-medium">{t("Organization name", "组织名称")}
            <input required autoComplete="off" list="contest-school-names" name="name" className="admin-input mt-1" defaultValue={entry?.schools[0]} />
          </label>
          <datalist id="contest-school-names">{schools.map(school => <option key={school} value={school} />)}</datalist>
          <label className="block text-sm font-medium">{t("Other school names", "学校或组织别名")}
            <textarea name="aliases" rows={2} className="admin-input mt-1" defaultValue={entry?.schools.slice(1).join("\n")} />
            <span className="mt-1 block text-xs font-normal text-gray-600">{t("Enter one name per line to match how teams registered.", "每行填写一个参赛队登记过的名称，这些名称共用同一个组织 Logo。")}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">{t("Organization ID", "组织 ID")}
              <input name="id" className="admin-input mt-1" defaultValue={entry?.id} placeholder={t("Optional", "选填")} />
            </label>
            <label className="block text-sm font-medium">{t("Country code", "国家或地区代码")}
              <input name="country" className="admin-input mt-1 uppercase" pattern="[A-Za-z]{2}" maxLength={2} defaultValue={entry?.country} placeholder={t("e.g. CN", "例如 CN")} />
            </label>
          </div>
          <div className="space-y-2">
            <label htmlFor="organization-logo-file" className="block text-sm font-medium">{t("Organization logo", "组织 Logo")}</label>
            <div className="flex items-center gap-3">
              {image && <Image src={image} unoptimized width={48} height={48} alt={t("Logo preview", "Logo 预览")} className="size-12 shrink-0 object-contain" />}
              <input id="organization-logo-file" ref={fileInput} type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="w-full min-w-0 text-sm file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-gray-300 file:px-2.5 file:py-1.5"
                onChange={event => {
                  const file = event.target.files?.[0];
                  setPreview(file ? URL.createObjectURL(file) : "");
                  if (file) setRemove(false);
                }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-gray-600">PNG / JPEG / WebP / SVG · {t("up to 2 MiB", "最大 2 MiB")}</span>
              {image && <button type="button" className="admin-text-link" onClick={() => {
                if (fileInput.current) fileInput.current.value = "";
                setPreview(""); setRemove(true);
              }}>{t("Remove logo", "移除 Logo")}</button>}
            </div>
            {remove && <input type="hidden" name="removeLogo" value="1" />}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
            <button type="button" className="admin-button" disabled={pending} onClick={onClose}>{t("Cancel", "取消")}</button>
            <button type="submit" className="admin-button admin-button-primary" disabled={pending}>{pending ? t("Saving…", "正在保存…") : t("Save", "保存")}</button>
          </div>
        </form>
      </DialogPanel>
    </div>
  </Dialog>;
}

export default function OrganizationManager({ entries, schools }: { entries: OrganizationEntry[]; schools: string[] }) {
  const { t, locale } = useAdminLocale();
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const errors: Record<OrganizationErrorCode, string> = {
    name: t("Enter an organization name.", "请填写组织名称。"),
    country: t("Enter a two-letter country code.", "国家或地区代码应为两个英文字母。"),
    duplicate: t("A school name or organization ID is already mapped.", "组织名称、别名或组织 ID 已被其他组织使用。"),
    stale: t("Another administrator changed this organization. Reopen it to edit the latest version.", "这条组织记录已被其他管理员更改，请重新打开编辑。"),
    image: t("Choose a valid PNG, JPEG, WebP or SVG image.", "请选择有效的 PNG、JPEG、WebP 或 SVG 图片。"),
    size: t("The logo must be 2 MiB or smaller.", "Logo 图片最大为 2 MiB。"),
    legacy: t("The existing organization map could not be imported. Check the configured JSON file.", "无法导入已有组织映射，请检查原组织映射 JSON 文件。"),
  };
  const search = query.trim().toLowerCase();
  const visible = entries.filter(entry => [...entry.schools, entry.id, entry.country].some(text => text.toLowerCase().includes(search)))
    .sort((a, b) => a.schools[0].localeCompare(b.schools[0], locale));

  function commit(action: () => Promise<Result>, message: string) {
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          toast.error(errors[result.error]);
          if (result.error === "stale") { setEditor(null); router.refresh(); }
          return;
        }
        setEditor(null);
        toast.success(message);
      } catch {
        toast.error(t("Unable to save changes. Please try again.", "保存失败，请重试。"));
      }
    });
  }

  return <div className="space-y-5">
    <AdminPageHeader title={t("Organizations", "组织管理")} description={t("Map team registrations to organization IDs, countries and scoreboard logos.", "将参赛队登记的学校名称映射到组织 ID、国家或地区和排行榜 Logo。")}>
      <button className="admin-button admin-button-primary" disabled={pending} onClick={() => setEditor({ entry: null })}><PlusIcon className="size-4" />{t("Add organization", "新增组织")}</button>
    </AdminPageHeader>
    <section className="admin-card overflow-hidden">
      <div className="p-3.5 sm:p-4"><input type="search" aria-label={t("Search organizations", "搜索组织")} value={query} onChange={e => setQuery(e.target.value)}
        className="admin-input max-w-sm" placeholder={t("Search by school name or ID", "搜索组织名称、别名或 ID")} /></div>
      <AdminTable label={t("Organization mappings", "组织映射")}>
        <thead><tr><th scope="col">Logo</th><th scope="col">{t("Organization", "组织名称")}</th><th scope="col">{t("ID", "组织 ID")}</th>
          <th scope="col">{t("Country", "国家或地区")}</th><th scope="col" className="text-right">{t("Actions", "操作")}</th></tr></thead>
        <tbody>{visible.map(entry => <tr key={entry.key}>
          <td><OrganizationLogo hash={entry.logoHash} /></td>
          <th scope="row" className="font-medium text-gray-900">{entry.schools[0]}
            {entry.schools.length > 1 && <span className="block text-xs font-normal text-gray-600">{entry.schools.slice(1).join(" · ")}</span>}</th>
          <td>{entry.id || "—"}</td><td>{entry.country || "—"}</td>
          <td><div className="flex justify-end gap-3">
            <button type="button" disabled={pending} className="admin-text-link" onClick={() => setEditor({ entry })}>{t("Edit", "编辑")}</button>
            <button type="button" disabled={pending} className="cursor-pointer text-red-700 hover:underline" onClick={() => {
              if (window.confirm(t(`Delete the organization mapping for ${entry.schools[0]}?`, `删除“${entry.schools[0]}”的组织映射？`)))
                commit(() => deleteOrganization(entry.key, entry.version), t("Organization deleted", "组织已删除"));
            }}>{t("Delete", "删除")}</button>
          </div></td>
        </tr>)}
          {!visible.length && <tr><td colSpan={5} className="text-center text-gray-500">{search ? t("No matches", "没有匹配的组织") : t("No organizations yet", "暂无组织")}</td></tr>}
        </tbody>
      </AdminTable>
    </section>
    {editor && <EditorForm entry={editor.entry} schools={schools} pending={pending} onClose={() => setEditor(null)}
      onSave={form => commit(() => saveOrganization(form), t("Organization saved", "组织已保存"))} />}
  </div>;
}
