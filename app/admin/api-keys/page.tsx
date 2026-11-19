import { createAdminLocale } from "@/lib/admin-locale";
import { getLanguage } from "@/lib/get-dictionary";
import { AdminPageHeader } from "@/components/admin/AdminPage";

import { getApiKeys } from "./actions";
import ApiKeyManager from "./ApiKeyManager";

export default async function ApiKeysPage() {
  const { t } = createAdminLocale(await getLanguage());
  const keys = await getApiKeys();

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("API Keys", "API 密钥")} description={t("Create and manage keys for external integrations. Store them like passwords.", "为外部集成创建和管理 API 密钥。请像保管密码一样保管密钥。")} />
      <ApiKeyManager initialKeys={keys} />
    </div>
  );
}
