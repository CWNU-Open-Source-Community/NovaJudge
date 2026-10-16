"use client";

import { useState } from "react";
import { updateContest } from "./actions";
import MarkdownEditor from "@/components/MarkdownEditor";
import { toast } from "sonner";
import {
  TrophyIcon,
  LockClosedIcon,
  GlobeAltIcon,
  AdjustmentsHorizontalIcon,
  CheckCircleIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { Contest, ContestConfig } from "./page";

interface Props {
  contest: Contest;
}

// 辅助函数：格式化时间为 datetime-local 支持的格式 (YYYY-MM-DDTHH:mm)
const formatDate = (date: Date) => {
  const d = new Date(date);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

export default function EditForm({ contest }: Props) {
  // 解析 Config
  const config = (contest.config as ContestConfig) || {};
  const initialMedal = config.medal || {
    mode: "ratio",
    gold: 10,
    silver: 20,
    bronze: 30,
  };

  // States
  const [isPrivate, setIsPrivate] = useState(contest.type === "PRIVATE");
  const [medalMode, setMedalMode] = useState<"ratio" | "fixed">(
    initialMedal.mode,
  );
  const [description, setDescription] = useState(contest.description || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setIsSaving(true);
    try {
      const result = await updateContest(contest.id, formData);
      if (result?.error) {
        toast.error(result.error);
        setIsSaving(false);
      }
    } catch (err) {
      const e = err as Error;
      if (e.message === "NEXT_REDIRECT") {
        return;
      }

      // 其他真正的错误才弹窗
      toast.error("Update failed: " + e.message);
      setIsSaving(false);
    }
  };

  return (
    <form
      action={handleSubmit}
      className="grid grid-cols-1 lg:grid-cols-3 gap-8"
    >
      {/* === 左侧主栏 (2/3) === */}
      <div className="lg:col-span-2 space-y-8">
        {/* 1. 基础信息 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-800">Basic Information</h2>
          </div>
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Contest Title
              </label>
              <input
                type="text"
                name="title"
                required
                defaultValue={contest.title}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  name="startTime"
                  required
                  defaultValue={formatDate(contest.startTime)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  name="endTime"
                  required
                  defaultValue={formatDate(contest.endTime)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Description / Rules
              </label>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <MarkdownEditor
                  value={description}
                  onChange={setDescription}
                  height={400}
                />
              </div>
              <input type="hidden" name="description" value={description} />
            </div>
          </div>
        </div>

        {/* 2. 奖牌设置 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <TrophyIcon className="w-5 h-5 text-yellow-500" />
            <h2 className="font-semibold text-gray-800">Awards & Medals</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4 mb-4">
              <span className="text-sm font-medium text-gray-700">Mode:</span>
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMedalMode("ratio")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    medalMode === "ratio"
                      ? "bg-white shadow text-blue-600"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Ratio (%)
                </button>
                <button
                  type="button"
                  onClick={() => setMedalMode("fixed")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    medalMode === "fixed"
                      ? "bg-white shadow text-blue-600"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Fixed Count
                </button>
              </div>
              <input type="hidden" name="medalMode" value={medalMode} />
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-yellow-600 uppercase">
                  Gold
                </label>
                <div className="relative">
                  <input
                    type="number"
                    name="medal_gold"
                    defaultValue={initialMedal.gold}
                    min={0}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-yellow-500 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">
                    {medalMode === "ratio" ? "%" : ""}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase">
                  Silver
                </label>
                <div className="relative">
                  <input
                    type="number"
                    name="medal_silver"
                    defaultValue={initialMedal.silver}
                    min={0}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-gray-400 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">
                    {medalMode === "ratio" ? "%" : ""}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-orange-600 uppercase">
                  Bronze
                </label>
                <div className="relative">
                  <input
                    type="number"
                    name="medal_bronze"
                    defaultValue={initialMedal.bronze}
                    min={0}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-orange-500 outline-none"
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">
                    {medalMode === "ratio" ? "%" : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === 右侧边栏 (1/3) === */}
      <div className="space-y-8">
        {/* 3. 访问权限 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <LockClosedIcon className="w-5 h-5 text-gray-600" />
            <h2 className="font-semibold text-gray-800">Access Control</h2>
          </div>
          <div className="p-6 space-y-6">
            {/* Visibility Toggle */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3">
                Visibility
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="visible"
                  value="true"
                  defaultChecked={contest.visible}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded"
                />
                <span className="text-sm text-gray-700 font-medium">
                  Show in Contest List (Publicly Visible)
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">
                Uncheck to create a hidden contest (accessible only via direct
                link).
              </p>
            </div>

            <div className="space-y-3">
              <label
                className={`flex items-center gap-3 border p-3 rounded-lg cursor-pointer transition-all ${
                  !isPrivate
                    ? "bg-blue-50 border-blue-200 ring-1 ring-blue-200"
                    : "hover:bg-gray-50 border-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="PUBLIC"
                  checked={!isPrivate}
                  onChange={() => setIsPrivate(false)}
                  className="text-blue-600 w-4 h-4"
                />
                <div>
                  <div className="font-bold text-gray-800 text-sm">
                    Public Contest
                  </div>
                  <div className="text-xs text-gray-500">
                    Visible to everyone
                  </div>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 border p-3 rounded-lg cursor-pointer transition-all ${
                  isPrivate
                    ? "bg-yellow-50 border-yellow-200 ring-1 ring-yellow-200"
                    : "hover:bg-gray-50 border-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="PRIVATE"
                  checked={isPrivate}
                  onChange={() => setIsPrivate(true)}
                  className="text-yellow-600 w-4 h-4"
                />
                <div>
                  <div className="font-bold text-gray-800 text-sm">
                    Private Contest
                  </div>
                  <div className="text-xs text-gray-500">Password required</div>
                </div>
              </label>
            </div>

            {isPrivate && (
              <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Contest Password
                </label>
                <input
                  type="text"
                  name="password"
                  defaultValue={contest.password || ""}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 font-mono text-center tracking-widest"
                />
              </div>
            )}
          </div>
        </div>

        {/* 4. 榜单设置 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <DocumentTextIcon className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-gray-800">Editorial PDF</h2>
          </div>
          <div className="p-6 space-y-4">
            {config.editorialPdf ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                Current file: {config.editorialPdf.filename}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                No editorial PDF uploaded yet.
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Upload PDF
              </label>
              <input
                type="file"
                name="editorialPdf"
                accept="application/pdf,.pdf"
                className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-red-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-red-700 hover:file:bg-red-100"
              />
              <p className="mt-2 text-xs text-gray-500">
                The file is shown to contestants after the contest ends.
              </p>
            </div>

            {config.editorialPdf && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  name="removeEditorialPdf"
                  value="true"
                  className="w-4 h-4 text-red-600 focus:ring-red-500 rounded"
                />
                Remove current editorial PDF
              </label>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <AdjustmentsHorizontalIcon className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-800">Scoreboard</h2>
          </div>
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Frozen Time (mins)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="frozenDuration"
                  defaultValue={config.frozenDuration || 60}
                  min={0}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  before end
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Auto Unfreeze (hours)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="unfreezeDelay"
                  defaultValue={config.unfreezeDelay || 300}
                  min={0}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  after end
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg flex justify-center items-center gap-2 disabled:opacity-70"
        >
          {isSaving ? (
            "Saving..."
          ) : (
            <>
              <CheckCircleIcon className="w-6 h-6" />
              Save Changes
            </>
          )}
        </button>
      </div>
    </form>
  );
}
