"use client";

import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@headlessui/react";
import CliSettings from "./CliSettings";
import { AdminPageHeader } from "@/components/admin/AdminPage";

const envTextZh: Record<string, { label: string; description: string }> = {
  DATABASE_URL: { label: "数据库地址", description: "Prisma 使用的 PostgreSQL 连接字符串。" },
  REDIS_URL: { label: "Redis 地址", description: "判题队列、缓存和实时状态使用的 Redis 连接字符串。" },
  GO_JUDGE_API: { label: "go-judge 接口地址", description: "go-judge 判题沙箱的基本地址。" },
  EXTERNAL_AUTH_URL: { label: "外部认证地址", description: "外部身份认证服务的密码登录接口。" },
  NOVAJUDGE_URL: { label: "NovaJudge 站点地址", description: "命令行工具和自动登录使用的站点地址。" },
};

type EnvSetting = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  restartRequired: boolean;
  value: string;
};

type SettingsResponse = {
  allowExternalLogin: boolean;
  envSettings: EnvSetting[];
};

export default function SystemSettingsPage() {
  const { t, lang } = useAdminLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allowExternalLogin, setAllowExternalLogin] = useState(false);
  const [envSettings, setEnvSettings] = useState<EnvSetting[]>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const notifyLoadError = useEffectEvent(() => toast.error(t("Failed to load settings", "加载设置失败")));

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load settings");
        return res.json() as Promise<SettingsResponse>;
      })
      .then((data) => {
        setAllowExternalLogin(data.allowExternalLogin);
        setEnvSettings(data.envSettings || []);
        setEnvValues(
          Object.fromEntries(
            (data.envSettings || []).map((item) => [item.key, item.value]),
          ),
        );
      })
      .catch(() => {
        notifyLoadError();
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const saveSettings = async (nextAllowExternalLogin = allowExternalLogin) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowExternalLogin: nextAllowExternalLogin,
          envSettings: envValues,
        }),
      });

      if (!res.ok) throw new Error("Failed to save settings");

      const data = (await res.json()) as SettingsResponse;
      setAllowExternalLogin(data.allowExternalLogin);
      setEnvSettings(data.envSettings || []);
      setEnvValues(
        Object.fromEntries(
          (data.envSettings || []).map((item) => [item.key, item.value]),
        ),
      );
      toast.success(t("Settings saved", "设置已保存"));
    } catch {
      toast.error(t("Failed to save settings", "保存设置失败"));
      throw new Error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    const previous = allowExternalLogin;
    setAllowExternalLogin(checked);
    try {
      await saveSettings(checked);
    } catch {
      setAllowExternalLogin(previous);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await saveSettings();
    } catch {
      // Toast is handled in saveSettings.
    }
  };

  if (loading) return <p role="status" className="admin-card p-5 text-sm text-gray-600">{t("Loading settings…", "正在加载设置…")}</p>;

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("System Settings", "系统设置")} description={t("Manage site sign-in and service connections.", "配置站点登录方式和基础服务连接。")} />

      <section className="admin-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h2 className="text-lg font-medium text-gray-900">
              {t("Allow External Login", "允许外部登录")}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("When enabled, users can sign in through the configured external identity provider.", "开启后，用户可以通过已配置的外部身份认证服务登录。")}
            </p>
          </div>

          <Switch
            aria-label={t("Allow external login", "允许外部登录")}
            checked={allowExternalLogin}
            onChange={handleToggle}
            disabled={saving}
            className={`${
              allowExternalLogin ? "bg-blue-600" : "bg-gray-200"
            } relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span
              className={`${
                allowExternalLogin ? "translate-x-6" : "translate-x-1"
              } inline-block h-4 w-4 rounded-full bg-white transition-transform`}
            />
          </Switch>
        </div>
      </section>
      <CliSettings />

      <form onSubmit={handleSubmit} className="admin-card p-4 sm:p-5">
        <div className="flex flex-col gap-2 border-b border-gray-200 pb-5">
          <h2 className="text-lg font-medium text-gray-900">
            {t("Environment Links", "服务连接")}
          </h2>
          <p className="text-sm text-gray-500">
            {t("These values are written to the project .env file. Current web requests will see updated values after saving, but database, Redis, judge, and worker connections may require a process restart.", "设置会写入项目的 .env 文件。数据库、Redis 和判题服务连接更新后需要重启对应进程。")}
          </p>
        </div>

        <div className="mt-6 grid gap-5">
          {envSettings.map((setting) => (
            <label key={setting.key} className="block">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {(lang === "zh" && envTextZh[setting.key]?.label) || setting.label}
                </span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {setting.key}
                </code>
                {setting.restartRequired && (
                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    {t("restart required", "需要重启")}
                  </span>
                )}
              </div>
              <input
                value={envValues[setting.key] || ""}
                onChange={(event) =>
                  setEnvValues((current) => ({
                    ...current,
                    [setting.key]: event.target.value,
                  }))
                }
                placeholder={setting.placeholder}
                spellCheck={false}
                className="admin-input font-mono"
              />
              <p className="mt-1 text-xs text-gray-500">
                {(lang === "zh" && envTextZh[setting.key]?.description) || setting.description}
              </p>
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="admin-button admin-button-primary"
          >
            {saving ? t("Saving...", "正在保存…") : t("Save Link Settings", "保存连接设置")}
          </button>
        </div>
      </form>
    </div>
  );
}
