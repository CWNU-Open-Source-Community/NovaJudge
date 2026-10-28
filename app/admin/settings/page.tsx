"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import CliSettings from "./CliSettings";

type EnvSetting = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  restartRequired: boolean;
  value: string;
};

type SettingsResponse = {
  envSettings: EnvSetting[];
};

export default function SystemSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [envSettings, setEnvSettings] = useState<EnvSetting[]>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load settings");
        return res.json() as Promise<SettingsResponse>;
      })
      .then((data) => {
        setEnvSettings(data.envSettings || []);
        setEnvValues(
          Object.fromEntries(
            (data.envSettings || []).map((item) => [item.key, item.value]),
          ),
        );
      })
      .catch(() => {
        toast.error("Failed to load settings");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const hasRestartRequiredSetting = useMemo(
    () => envSettings.some((item) => item.restartRequired),
    [envSettings],
  );

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envSettings: envValues,
        }),
      });

      if (!res.ok) throw new Error("Failed to save settings");

      const data = (await res.json()) as SettingsResponse;
      setEnvSettings(data.envSettings || []);
      setEnvValues(
        Object.fromEntries(
          (data.envSettings || []).map((item) => [item.key, item.value]),
        ),
      );
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
      throw new Error("Failed to save settings");
    } finally {
      setSaving(false);
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

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
        <p className="mt-2 text-sm text-gray-500">
          Manage runtime service links for the judge platform.
        </p>
      </div>

      <CliSettings />

      <form onSubmit={handleSubmit} className="rounded-lg bg-white p-6 shadow">
        <div className="flex flex-col gap-2 border-b border-gray-200 pb-5">
          <h2 className="text-lg font-medium text-gray-900">
            Environment Links
          </h2>
          <p className="text-sm text-gray-500">
            These values are written to the project .env file. Current web
            requests will see updated values after saving, but database, Redis,
            judge, and worker connections may require a process restart.
          </p>
        </div>

        <div className="mt-6 grid gap-5">
          {envSettings.map((setting) => (
            <label key={setting.key} className="block">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {setting.label}
                </span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {setting.key}
                </code>
                {setting.restartRequired && (
                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    restart required
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-xs text-gray-500">
                {setting.description}
              </p>
            </label>
          ))}
        </div>

        {hasRestartRequiredSetting && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Infrastructure links are loaded when Prisma, Redis, BullMQ, and the
            worker start. Save updates the .env file, then restart the affected
            services before relying on those new connections.
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Link Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
