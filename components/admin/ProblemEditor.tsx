"use client";

import { AdminPageHeader } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useRef, useState } from "react";
import Link from "next/link";
import MarkdownEditor from "@/components/MarkdownEditor";
import { toast } from "sonner";
import {
  createCommunicationSample,
  getCommunicationSampleDisplay,
  type ProblemSample,
} from "@/lib/problem-samples";
import { createDefaultProblemSections, type ProblemSection } from "@/lib/problem-section-templates";

interface ProblemData {
  id?: number;
  title: string;
  type: string;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  sections: ProblemSection[];
  samples: ProblemSample[];
  hint?: string;
  judgeConfig?: string;
}

// 定义 Props，如果是编辑模式会传入 initialData
interface ProblemEditorProps {
  initialData?: ProblemData;
  isEdit?: boolean;
}

export default function ProblemEditor({
  initialData,
  isEdit = false,
}: ProblemEditorProps) {
  const { t } = useAdminLocale();
  const [loading, setLoading] = useState(false);

  // 基础字段状态
  const [title, setTitle] = useState(initialData?.title || "");
  const [timeLimit, setTimeLimit] = useState(
    initialData?.defaultTimeLimit || 1000,
  );
  const [memoryLimit, setMemoryLimit] = useState(
    initialData?.defaultMemoryLimit || 128,
  );
  const [type, setType] = useState(initialData?.type || "default");
  const [hint, setHint] = useState(initialData?.hint || "");

  // 动态数组：Sections (题面描述)
  const [sections, setSections] = useState<ProblemSection[]>(() =>
    initialData?.sections ?? createDefaultProblemSections(initialData?.type || "default"),
  );
  const sectionDrafts = useRef<Partial<Record<"standard" | "communication", ProblemSection[]>>>({});

  const changeType = (nextType: string) => {
    const currentTemplate = type === "communication" ? "communication" : "standard";
    const nextTemplate = nextType === "communication" ? "communication" : "standard";
    if (!isEdit && currentTemplate !== nextTemplate) {
      // 切换回某一题型时恢复正在编辑的草稿；已有题目始终使用保存的 sections。
      sectionDrafts.current[currentTemplate] = sections;
      setSections(sectionDrafts.current[nextTemplate] ?? createDefaultProblemSections(nextType));
    }
    setType(nextType);
  };

  // 动态数组：Samples (样例)
  const [samples, setSamples] = useState<ProblemSample[]>(
    initialData?.samples || [
      initialData?.type === "communication"
        ? createCommunicationSample()
        : { input: "", output: "" },
    ],
  );

  // 辅助函数：处理数组变更
  const updateSection = (
    idx: number,
    field: "title" | "content",
    val: string,
  ) => {
    setSections((current) => current.map((section, i) =>
      i === idx ? { ...section, [field]: val } : section,
    ));
  };

  const updateSample = (
    idx: number,
    field: "input" | "output",
    val: string,
  ) => {
    setSamples((current) => current.map((sample, i) =>
      i === idx ? { ...sample, [field]: val } : sample,
    ));
  };

  const updateCommunicationSample = (
    idx: number,
    field: "firstOutput" | "secondInput" | "secondOutput",
    val: string,
  ) => {
    setSamples((current) => current.map((sample, i) => {
      if (i !== idx) return sample;
      const display = getCommunicationSampleDisplay(sample);
      return {
        ...sample,
        communication: {
          firstOutput: display.firstOutput,
          secondInput: display.secondInput,
          secondOutput: display.secondOutput,
          [field]: val,
        },
      };
    }));
  };

  const insertCommunicationExample = () => {
    const example: ProblemSample = {
      input: "first\n5\n1 2 3 4 5",
      output: "",
      communication: {
        firstOutput: "abcde",
        secondInput: "second\nabcde",
        secondOutput: "5\n1 2 3 4 5",
      },
    };
    setSamples((current) => {
      const onlySample = current.length === 1 ? current[0] : undefined;
      if (onlySample && onlySample.output === "" &&
        Object.values(getCommunicationSampleDisplay(onlySample)).every((value) => value === "")) {
        return [example];
      }
      return [...current, example];
    });
  };

  // 提交表单
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    if (isEdit && initialData?.id) {
      formData.append("id", initialData.id.toString());
    }
    formData.append("title", title);
    formData.append("type", type);
    formData.append("defaultTimeLimit", timeLimit.toString());
    formData.append("defaultMemoryLimit", memoryLimit.toString());
    formData.append("hint", hint);

    // 序列化 JSON 字段
    formData.append("sections", JSON.stringify(sections));
    formData.append("samples", JSON.stringify(samples));

    // 动态导入 Server Action 以避免客户端打包问题
    const { saveProblem } = await import("@/app/admin/problems/actions");
    const result = await saveProblem(formData);
    if (result?.error) {
      toast.error(result.error);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-6xl space-y-5 pb-8">
      <AdminPageHeader title={isEdit ? t("Edit problem #" + initialData?.id, "编辑题目 #" + initialData?.id) : t("Create New Problem", "创建题目")}>
        <Link href="/admin/problems" className="admin-button">{t("Cancel", "取消")}</Link>
        <button type="submit" disabled={loading} className="admin-button admin-button-primary">{loading ? t("Saving…", "正在保存…") : t("Save Problem", "保存题目")}</button>
      </AdminPageHeader>

      {/* 1. 基本信息 */}
      <div className="bg-white p-6 rounded shadow-sm border border-gray-200">
        <h2 className="text-lg font-bold mb-4 text-gray-700">{t("Basic Info", "基本信息")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("Title", "标题")}
            </label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("Time Limit (ms)", "时间限制（毫秒）")}
            </label>
            <input
              type="number"
              value={timeLimit}
              onChange={(e) => setTimeLimit(Number(e.target.value))}
              className="w-full border border-gray-300 rounded p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("Memory Limit (MB)", "内存限制（MB）")}
            </label>
            <input
              type="number"
              value={memoryLimit}
              onChange={(e) => setMemoryLimit(Number(e.target.value))}
              className="w-full border border-gray-300 rounded p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("Judge Type", "判题类型")}
            </label>
            <select
              value={type}
              onChange={(e) => changeType(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 bg-white"
            >
              <option value="default">{t("Default (Standard IO)", "标准输入输出")}</option>
              <option value="spj">{t("Special Judge", "自定义判定")}</option>
              <option value="interactive">{t("Interactive", "交互题")}</option>
              <option value="communication">
                {t("Communication (Run twice)", "两轮通信")}
              </option>
            </select>
          </div>
          {type === "communication" && (
            <div className="md:col-span-2 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-2">
              <p>
                {t("The same solution runs twice, with input/output or interaction as defined by the problem. Each run starts fresh, with separate time and memory limits; memory and files are not shared between runs.", "同一份选手程序会运行两次。每轮从独立环境开始，分别计算时间和内存，输入输出与交互方式以题面为准。")}
              </p>
              <p>
                {t("The runs communicate only through the limited message defined by the problem. Describe the format for each run, how to identify the run, and the message restrictions in the statement.", "请在题面说明每轮的数据格式、轮次标识和允许传递的消息。")}
              </p>
              <p>
                {t("For native communication problems, save the problem, then upload", "使用原生通信题时，先保存题目，再上传")} <code>communicator.cpp</code> {t("and the test data in Data Management to prepare the second input and judge the result. Polygon imports include their own checker/interactor configuration; keep that configuration in Data Management.", "和测试数据，由裁判程序准备下一轮输入并判定结果。Polygon 导入题请保留原有 checker 和 interactor 配置。")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 2. 题面描述 (Sections) */}
      <div className="bg-white p-6 rounded shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-700">
            {t("Description Sections", "题面章节")}
          </h2>
          <button
            type="button"
            onClick={() =>
              setSections([...sections, { title: t("New Section", "新章节"), content: "" }])
            }
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {t("+ Add Section", "添加章节")}
          </button>
        </div>

        <div className="space-y-8">
          {sections.map((sec, idx) => (
            <div
              key={idx}
              className="border p-4 rounded bg-gray-50 relative group"
            >
              <button
                type="button"
                onClick={() =>
                  setSections(sections.filter((_, i) => i !== idx))
                }
                className="absolute top-2 right-2 text-red-400 hover:text-red-600 z-10 bg-white px-2 py-1 rounded shadow-sm text-xs font-bold cursor-pointer"
              >
                {t("Remove Block", "删除章节")}
              </button>

              <div className="mb-4">
                <input
                  value={sec.title}
                  onChange={(e) => updateSection(idx, "title", e.target.value)}
                  className="block w-full text-lg font-bold bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none pb-2"
                  placeholder={t("Section Title (e.g. Input)", "章节标题（如输入格式）")}
                />
              </div>

              <MarkdownEditor
                value={sec.content}
                onChange={(val) => updateSection(idx, "content", val)}
                height={300} // 设置合适的高度
              />
            </div>
          ))}
        </div>
      </div>

      {/* 提示 Hint */}
      <div className="bg-white p-6 rounded shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-700">{t("Hint", "提示")}</h2>
        </div>
        <MarkdownEditor
          value={hint}
          onChange={(val) => setHint(val)}
          height={300} // 设置合适的高度
        />
      </div>

      {/* 3. 样例 (Samples) */}
      <div className="bg-white p-6 rounded shadow-sm border border-gray-200">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <h2 className="text-lg font-bold text-gray-700">{t("Samples", "样例")}</h2>
          <div className="flex flex-wrap gap-4">
          {type === "communication" && (
            <button
              type="button"
              onClick={insertCommunicationExample}
              className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              {t("Insert first/second markers", "+ 插入 first/second 示例")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSamples((current) => [
              ...current,
              type === "communication" ? createCommunicationSample() : { input: "", output: "" },
            ])}
            className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
          >
            {type === "communication" ? t("Add two-run sample", "+ 添加两轮样例") : t("+ Add Sample", "添加样例")}
          </button>
          </div>
        </div>

        <div className="space-y-4">
          {type === "communication" && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
              <p>
                {t("Each sample shows two runs for one test case. If the problem uses", "每个样例展示同一个测试点的两次运行。若题目约定使用")}
                <code className="mx-1">first</code> {t("and", "和")} <code className="mx-1">second</code>{t("put these markers on the first line of their respective inputs.", "， 请把它们写在对应输入的第一行，系统不会自动添加。")}
              </p>
              <p>
                {t("The outputs and the second-run input are one valid example. Debugging starts from the first input. The judge creates the second input from the program's actual output and checks the result.", "两轮输出与第二轮输入用于题面展示，只代表一种合法通信方案。 调试时从第一轮输入开始，通信裁判根据程序实际输出生成第二轮输入并判定结果， 不要求程序输出与这里的示例一致。")}
              </p>
            </div>
          )}
          {samples.map((sample, idx) => {
            if (type === "communication") {
              const display = getCommunicationSampleDisplay(sample);
              return (
                <div key={idx} className="rounded border border-gray-200 bg-gray-50 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-gray-800">{t("Sample #", "样例 #")}{idx + 1}</h3>
                    <button
                      type="button"
                      onClick={() => setSamples((current) => current.filter((_, i) => i !== idx))}
                      aria-label={t(`Remove sample ${idx + 1}`, `删除样例 ${idx + 1}`)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      {t("Remove sample", "删除样例")}
                    </button>
                  </div>
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-gray-700">{t("First run", "第一次运行")}</legend>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`sample-${idx}-first-input`} className="block text-xs font-semibold text-gray-600 mb-1">
                          {t("First-run input", "第一轮输入")}
                        </label>
                        <textarea
                          id={`sample-${idx}-first-input`}
                          value={sample.input}
                          onChange={(e) => updateSample(idx, "input", e.target.value)}
                          placeholder={"first\n…"}
                          className="w-full h-32 p-2 border border-gray-300 rounded font-mono text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label htmlFor={`sample-${idx}-first-output`} className="block text-xs font-semibold text-gray-600 mb-1">
                          {t("First-run output (example message)", "第一轮输出（示例消息）")}
                        </label>
                        <textarea
                          id={`sample-${idx}-first-output`}
                          value={display.firstOutput}
                          onChange={(e) => updateCommunicationSample(idx, "firstOutput", e.target.value)}
                          className="w-full h-32 p-2 border border-gray-300 rounded font-mono text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </fieldset>
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-gray-700">{t("Second run", "第二次运行")}</legend>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`sample-${idx}-second-input`} className="block text-xs font-semibold text-gray-600 mb-1">
                          {t("Second-run input (example)", "第二轮输入（示例）")}
                        </label>
                        <textarea
                          id={`sample-${idx}-second-input`}
                          value={display.secondInput}
                          onChange={(e) => updateCommunicationSample(idx, "secondInput", e.target.value)}
                          placeholder={"second\n…"}
                          className="w-full h-32 p-2 border border-gray-300 rounded font-mono text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label htmlFor={`sample-${idx}-second-output`} className="block text-xs font-semibold text-gray-600 mb-1">
                          {t("Second-run output (example)", "第二轮输出（示例）")}
                        </label>
                        <textarea
                          id={`sample-${idx}-second-output`}
                          value={display.secondOutput}
                          onChange={(e) => updateCommunicationSample(idx, "secondOutput", e.target.value)}
                          className="w-full h-32 p-2 border border-gray-300 rounded font-mono text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </fieldset>
                  <details className="rounded border border-gray-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">
                      {t("Reference answer (optional, admins only)", "裁判参考答案（可选，仅管理员可见）")}
                    </summary>
                    <p id={`sample-${idx}-reference-help`} className="mt-3 mb-2 text-xs text-gray-500">
                      {t("Fill in a reference answer only if the communication checker uses one. Only administrators can see this field.", "仅在通信裁判需要读取参考答案时填写；不使用参考答案时留空。此字段不会展示给选手。")}
                    </p>
                    <label htmlFor={`sample-${idx}-reference`} className="block text-xs font-semibold text-gray-600 mb-1">
                      {t("Reference answer", "裁判参考答案")}
                    </label>
                    <textarea
                      id={`sample-${idx}-reference`}
                      aria-describedby={`sample-${idx}-reference-help`}
                      value={sample.output}
                      onChange={(e) => updateSample(idx, "output", e.target.value)}
                      className="w-full h-24 p-2 border border-gray-300 rounded font-mono text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </details>
                </div>
              );
            }

            return (
            <div key={idx} className="flex gap-4 items-start">
              <div className="flex-1">
                <label htmlFor={`sample-${idx}-input`} className="text-xs font-bold text-gray-500">
                  {t("Input #", "输入 #")}{idx + 1}
                </label>
                <textarea
                  id={`sample-${idx}-input`}
                  value={sample.input}
                  onChange={(e) => updateSample(idx, "input", e.target.value)}
                  className="w-full h-24 p-2 border border-gray-300 rounded font-mono text-sm"
                />
              </div>
              <div className="flex-1">
                <label htmlFor={`sample-${idx}-output`} className="text-xs font-bold text-gray-500">
                  {t("Output #", "输出 #")}{idx + 1}
                </label>
                <textarea
                  id={`sample-${idx}-output`}
                  value={sample.output}
                  onChange={(e) => updateSample(idx, "output", e.target.value)}
                  className="w-full h-24 p-2 border border-gray-300 rounded font-mono text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => setSamples(samples.filter((_, i) => i !== idx))}
                className="mt-6 text-red-500 hover:text-red-700"
              >
                x
              </button>
            </div>
            );
          })}
        </div>
      </div>
    </form>
  );
}
