"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  TrophyIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  TrashIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { ContestStatus } from "@/lib/generated/prisma/enums";
import {
  getMedalCounts,
  formatFtsCitation,
  type ContestMedalConfig,
} from "@/lib/medal-utils";
import type {
  ContestAwardsConfig,
  FirstSolveInfo,
  StandingRow,
} from "@/lib/awards";
import { saveContestAwards } from "./actions";

interface CustomAwardDraft {
  citation: string;
  teamIds: string[];
}

interface AwardsClientProps {
  contestId: number;
  initial: {
    contest: {
      id: number;
      title: string;
      status: ContestStatus;
      startTime: Date;
      endTime: Date;
    };
    standings: StandingRow[];
    medal: ContestMedalConfig;
    awards: ContestAwardsConfig;
    problems: { problemId: number; displayId: string }[];
    firstSolves: FirstSolveInfo[];
  };
}

const inputClass =
  "rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const labelClass = "mb-1 block text-xs font-bold text-gray-600";

function medalChip(type: "gold" | "silver" | "bronze") {
  if (type === "gold")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-xs font-bold">
        🥇 Gold
      </span>
    );
  if (type === "silver")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-200 text-gray-700 text-xs font-bold">
        🥈 Silver
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 text-xs font-bold">
      🥉 Bronze
    </span>
  );
}

// 可搜索的多选队伍选择器
function TeamMultiSelect({
  teams,
  selected,
  onChange,
}: {
  teams: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = teams.filter(
    (t) =>
      !q ||
      t.value.toLowerCase().includes(q) ||
      t.label.toLowerCase().includes(q),
  );

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden bg-white">
      <div className="p-2 border-b border-gray-100 bg-gray-50">
        <input
          type="text"
          className="w-full text-sm px-2 py-1 rounded border border-gray-200 outline-none transition focus:border-blue-500"
          placeholder="搜索队伍（用户名 / 队名）..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
        {filtered.length === 0 && (
          <p className="p-2 text-xs text-gray-400">无匹配队伍</p>
        )}
        {filtered.map((t) => (
          <label
            key={t.value}
            className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
          >
            <input
              type="checkbox"
              className="rounded text-blue-600 focus:ring-blue-500"
              checked={selected.includes(t.value)}
              onChange={() => toggle(t.value)}
            />
            <span className="truncate">{t.label}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="p-2 border-t border-gray-100 flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-xs font-bold"
            >
              {v}
              <button
                type="button"
                className="hover:text-red-600 cursor-pointer"
                title="移除"
                onClick={() => onChange(selected.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AwardsClient({
  contestId,
  initial,
}: AwardsClientProps) {
  const router = useRouter();

  const [medal, setMedal] = useState<ContestMedalConfig>(initial.medal);
  const [enabled, setEnabled] = useState(initial.awards.enabled);
  const [baseCitations, setBaseCitations] = useState({
    gold: initial.awards.base?.gold || "",
    silver: initial.awards.base?.silver || "",
    bronze: initial.awards.base?.bronze || "",
  });
  const [custom, setCustom] = useState<CustomAwardDraft[]>(
    (initial.awards.custom || []).map((a) => ({
      citation: a.citation,
      teamIds: a.teamIds,
    })),
  );
  const [ftsEnabled, setFtsEnabled] = useState(
    initial.awards.firstToSolve ?? false,
  );
  const [excellenceEnabled, setExcellenceEnabled] = useState(
    initial.awards.excellenceAward ?? false,
  );
  const [excellenceCitation, setExcellenceCitation] = useState(
    initial.awards.excellenceCitation || "",
  );
  const [topThreeEnabled, setTopThreeEnabled] = useState(
    initial.awards.topThree ?? false,
  );
  const [top3Citations, setTop3Citations] = useState({
    champion: initial.awards.topThreeCitations?.champion || "",
    runnerUp: initial.awards.topThreeCitations?.runnerUp || "",
    third: initial.awards.topThreeCitations?.third || "",
  });

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { standings } = initial;
  const official = useMemo(
    () => standings.filter((t) => !t.isStar),
    [standings],
  );
  const counts = getMedalCounts(official.length, medal);

  // 榜单预览：金银铜 + 并列名次（与排行榜页口径一致）
  const preview = useMemo(() => {
    // 金银铜获奖队伍
    const medalByUsername = new Map<
      string,
      "gold" | "silver" | "bronze"
    >();
    official.slice(0, counts.gold).forEach((t) => {
      medalByUsername.set(t.username, "gold");
    });
    official
      .slice(counts.gold, counts.gold + counts.silver)
      .forEach((t) => {
        medalByUsername.set(t.username, "silver");
      });
    official
      .slice(
        counts.gold + counts.silver,
        counts.gold + counts.silver + counts.bronze,
      )
      .forEach((t) => {
        medalByUsername.set(t.username, "bronze");
      });

    // 名次（含并列，按整个榜单顺序计算，与排行榜页一致）
    const ranks = new Map<string, number>();
    standings.reduce<{ solved: number; penalty: number; rank: number }>(
      (acc, t, idx) => {
        const rank =
          t.solved === acc.solved && t.penalty === acc.penalty
            ? acc.rank
            : idx + 1;
        ranks.set(t.username, rank);
        return { solved: t.solved, penalty: t.penalty, rank };
      },
      { solved: -1, penalty: -1, rank: 0 },
    );

    return standings.map((t) => {
      const isOfficial = !t.isStar;
      return {
        ...t,
        rank: isOfficial ? String(ranks.get(t.username)) : "⭐",
        medal: isOfficial ? medalByUsername.get(t.username) : undefined,
      };
    });
  }, [standings, official, counts]);

  const teamOptions = useMemo(
    () =>
      standings.map((t) => ({
        value: t.username,
        label: `${t.username}${t.displayName ? ` (${t.displayName})` : ""}${
          t.isStar ? " ⭐打星" : ""
        }`,
      })),
    [standings],
  );

  // 冠军/亚军/季军预览（按学校去重：每个学校最多一个席位，取该校最好队伍）
  const topThreePreview = useMemo(() => {
    if (!topThreeEnabled) return [];
    const schoolsSeen = new Set<string>();
    const seats = [
      {
        key: "champion",
        label: "冠军",
        citation: top3Citations.champion || "冠军",
      },
      {
        key: "runnerUp",
        label: "亚军",
        citation: top3Citations.runnerUp || "亚军",
      },
      {
        key: "third",
        label: "季军",
        citation: top3Citations.third || "季军",
      },
    ];
    return seats.map((seat) => {
      const team = official.find(
        (t) => !schoolsSeen.has(t.school ?? "__none__"),
      );
      if (team) schoolsSeen.add(team.school ?? "__none__");
      return { ...seat, team: team ?? null };
    });
  }, [topThreeEnabled, top3Citations, official]);

  // 快速解题奖预览（每题一血，按队伍合并，含打星队伍）
  const ftsPreview = useMemo(() => {
    if (!ftsEnabled) return [];
    const starSet = new Set(
      standings.filter((t) => t.isStar).map((t) => t.username),
    );
    const labelsByTeam = new Map<string, string[]>();
    initial.firstSolves.forEach((fs) => {
      const arr = labelsByTeam.get(fs.username) || [];
      arr.push(fs.displayId);
      labelsByTeam.set(fs.username, arr);
    });
    return standings
      .map((t) => {
        const labels = labelsByTeam.get(t.username);
        if (!labels || labels.length === 0) return null;
        return {
          username: t.username,
          labels,
          isStar: starSet.has(t.username),
        };
      })
      .filter((x): x is { username: string; labels: string[]; isStar: boolean } =>
        x !== null,
      );
  }, [ftsEnabled, standings, initial.firstSolves]);

  // 优秀奖预览：未获金银铜、解出至少 1 题的队伍
  const excellencePreview = useMemo(() => {
    if (!excellenceEnabled) return [];
    const medalTeamIds = new Set(
      official.slice(0, counts.gold + counts.silver + counts.bronze).map(
        (t) => t.username,
      ),
    );
    return official.filter(
      (t) => t.solved > 0 && !medalTeamIds.has(t.username),
    );
  }, [excellenceEnabled, official, counts]);

  // 当前配置将生成的奖项事件总数（导出前核对用）
  const awardSummary = useMemo(() => {
    if (!enabled) return null;
    const parts: string[] = [];
    let total = 0;
    if (counts.gold > 0) {
      total++;
      parts.push(`金牌 ${counts.gold} 队`);
    }
    if (counts.silver > 0) {
      total++;
      parts.push(`银牌 ${counts.silver} 队`);
    }
    if (counts.bronze > 0) {
      total++;
      parts.push(`铜牌 ${counts.bronze} 队`);
    }
    if (topThreeEnabled) {
      const n = topThreePreview.filter((s) => s.team).length;
      if (n > 0) {
        total += n;
        parts.push(`冠亚季 ${n}`);
      }
    }
    if (ftsEnabled && ftsPreview.length > 0) {
      total += ftsPreview.length;
      parts.push(`一血 ${ftsPreview.length}`);
    }
    if (excellenceEnabled && excellencePreview.length > 0) {
      total++;
      parts.push(`优秀奖 ${excellencePreview.length} 队`);
    }
    const customN = custom.filter((a) => a.teamIds.length > 0).length;
    if (customN > 0) {
      total += customN;
      parts.push(`自定义 ${customN}`);
    }
    return { total, parts };
  }, [
    enabled,
    counts,
    topThreeEnabled,
    topThreePreview,
    ftsEnabled,
    ftsPreview,
    excellenceEnabled,
    excellencePreview,
    custom,
  ]);

  const setMedalField = (key: keyof ContestMedalConfig, value: string) => {
    const num = Number(value);
    setMedal((prev) => ({
      ...prev,
      [key]: Number.isFinite(num) ? Math.max(0, num) : 0,
    }));
  };

  const updateCustom = (
    index: number,
    patch: Partial<CustomAwardDraft>,
  ) => {
    setCustom((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  };

  const addCustom = () => {
    setCustom((prev) => [...prev, { citation: "", teamIds: [] }]);
  };

  const removeCustom = (index: number) => {
    setCustom((prev) => prev.filter((_, i) => i !== index));
  };

  // 组装保存/导出前需要落库的奖项配置
  const buildPayload = () => ({
    medal,
    awards: {
      enabled,
      base: {
        gold: baseCitations.gold.trim() || undefined,
        silver: baseCitations.silver.trim() || undefined,
        bronze: baseCitations.bronze.trim() || undefined,
      },
      firstToSolve: ftsEnabled,
      excellenceAward: excellenceEnabled,
      excellenceCitation: excellenceCitation.trim() || undefined,
      topThree: topThreeEnabled,
      topThreeCitations: {
        champion: top3Citations.champion.trim() || undefined,
        runnerUp: top3Citations.runnerUp.trim() || undefined,
        third: top3Citations.third.trim() || undefined,
      },
      custom: custom.map((a) => ({
        citation: a.citation.trim(),
        teamIds: a.teamIds,
      })),
    },
  });

  // 与页面初始数据比较，判断是否有未保存的修改
  const initialSnapshot = JSON.stringify({
    medal: initial.medal,
    enabled: initial.awards.enabled,
    baseCitations: {
      gold: initial.awards.base?.gold || "",
      silver: initial.awards.base?.silver || "",
      bronze: initial.awards.base?.bronze || "",
    },
    ftsEnabled: initial.awards.firstToSolve ?? false,
    excellenceEnabled: initial.awards.excellenceAward ?? false,
    excellenceCitation: initial.awards.excellenceCitation || "",
    topThreeEnabled: initial.awards.topThree ?? false,
    top3Citations: {
      champion: initial.awards.topThreeCitations?.champion || "",
      runnerUp: initial.awards.topThreeCitations?.runnerUp || "",
      third: initial.awards.topThreeCitations?.third || "",
    },
    custom: (initial.awards.custom || []).map((a) => ({
      citation: a.citation,
      teamIds: a.teamIds,
    })),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveContestAwards(contestId, buildPayload());
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("奖项设置已保存，导出 Event Feed 即可用于滚榜");
      router.refresh();
    } catch {
      toast.error("Failed to save awards");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const url = `/api/ccs/contests/${contestId}/event-feed?stream=false&runs=false`;
    setExporting(true);
    try {
      // 1. 有未保存的修改时先自动保存，避免导出不含奖项的旧配置
      const currentSnapshot = JSON.stringify({
        medal,
        enabled,
        baseCitations,
        ftsEnabled,
        excellenceEnabled,
        excellenceCitation,
        topThreeEnabled,
        top3Citations,
        custom,
      });
      if (currentSnapshot !== initialSnapshot) {
        const saveResult = await saveContestAwards(contestId, buildPayload());
        if (saveResult.error) {
          toast.error(`保存失败，已取消导出：${saveResult.error}`);
          return;
        }
        toast.success("已自动保存设置，开始导出…");
      }

      // 2. 导出
      let response = await fetch(url, { cache: "no-store" });
      if (response.status === 401) {
        const username = prompt(
          "Authentication required. Please enter CCS username (admin):",
          "admin",
        );
        if (!username) return;
        const password = prompt("Please enter CCS password:");
        if (!password) return;
        const credentials = btoa(`${username}:${password}`);
        response = await fetch(url, {
          headers: { Authorization: `Basic ${credentials}` },
        });
      }
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Unauthorized: Invalid credentials"
            : `Failed to fetch: ${response.statusText}`,
        );
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      // 带比赛 ID 和时间戳的文件名，避免下载多次后打开旧文件
      const ts = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "-");
      a.download = `event-feed-contest-${contestId}-${ts}.ndjson`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      toast.success("已导出（含奖项）。在 resolver 中滚榜到最后阶段即可看到奖项公布");
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const notEnded = initial.contest.status !== ContestStatus.ENDED;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 头部 */}
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrophyIcon className="w-7 h-7 text-amber-500" />
            Awards — {initial.contest.title}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Contest #{initial.contest.id} · 设置奖项后导出 Event Feed，即可用
            ICPC Tools resolver 滚榜
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exporting ? "Exporting..." : "保存并导出 Event Feed"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "保存奖项设置"}
          </button>
        </div>
      </div>

      {notEnded && (
        <div className="p-3 bg-amber-50 border-l-4 border-amber-400 rounded text-sm text-amber-800">
          比赛尚未结束（当前状态：{initial.contest.status}）。榜单可能还会变化，
          建议比赛结束后再设置奖项并导出。
        </div>
      )}

      {/* 金银铜设置 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-800 mb-4">1. 金银铜奖设置</h3>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name="medalMode"
                checked={medal.mode === "fixed"}
                onChange={() => setMedal({ ...medal, mode: "fixed" })}
                className="text-blue-600 focus:ring-blue-500"
              />
              固定数量
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name="medalMode"
                checked={medal.mode === "ratio"}
                onChange={() => setMedal({ ...medal, mode: "ratio" })}
                className="text-blue-600 focus:ring-blue-500"
              />
              按比例（百分比）
            </label>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className={labelClass}>金奖</label>
              <input
                type="number"
                min={0}
                className={inputClass + " w-24"}
                value={medal.gold}
                onChange={(e) => setMedalField("gold", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>银奖</label>
              <input
                type="number"
                min={0}
                className={inputClass + " w-24"}
                value={medal.silver}
                onChange={(e) => setMedalField("silver", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>铜奖</label>
              <input
                type="number"
                min={0}
                className={inputClass + " w-24"}
                value={medal.bronze}
                onChange={(e) => setMedalField("bronze", e.target.value)}
              />
            </div>
          </div>
          <div className="text-sm text-gray-600">
            正式队伍 <b className="text-gray-900">{official.length}</b> 支 →
            将产生{" "}
            <span className="font-bold text-amber-600">{counts.gold}</span> 金 /{" "}
            <span className="font-bold text-gray-600">{counts.silver}</span> 银
            / <span className="font-bold text-orange-600">{counts.bronze}</span>{" "}
            铜
          </div>
        </div>

        {/* 基础奖项名称（citation） */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-600 mb-2">
            奖项名称（滚榜时展示，留空则使用默认英文名）
          </p>
          <div className="flex flex-wrap gap-4">
            <input
              className={inputClass + " w-44"}
              placeholder="Gold Medal"
              value={baseCitations.gold}
              onChange={(e) =>
                setBaseCitations({ ...baseCitations, gold: e.target.value })
              }
            />
            <input
              className={inputClass + " w-44"}
              placeholder="Silver Medal"
              value={baseCitations.silver}
              onChange={(e) =>
                setBaseCitations({ ...baseCitations, silver: e.target.value })
              }
            />
            <input
              className={inputClass + " w-44"}
              placeholder="Bronze Medal"
              value={baseCitations.bronze}
              onChange={(e) =>
                setBaseCitations({ ...baseCitations, bronze: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      {/* 自动奖项 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6 space-y-5">
        <h3 className="font-bold text-gray-800">2. 自动奖项（可选）</h3>

        {/* 快速解题奖：每题一血，按队伍合并 */}
        <div className="p-4 border border-gray-200 rounded-lg">
          <label className="flex items-center gap-2 text-sm font-bold text-gray-800 cursor-pointer">
            <input
              type="checkbox"
              checked={ftsEnabled}
              onChange={(e) => setFtsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            快速解题奖（每题一血，打星队伍也参与评选；同一队伍多个一血合并为一个奖）
          </label>
          {ftsEnabled && (
            <div className="mt-3">
              <p className="text-xs font-bold text-gray-600 mb-1.5">
                预览（DOMjudge 原生格式，导出时自动计算）
              </p>
              {ftsPreview.length === 0 ? (
                <p className="text-sm text-gray-400">暂无 AC 记录。</p>
              ) : (
                <div className="space-y-1">
                  {ftsPreview.map((f) => (
                    <div
                      key={f.username}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="px-2.5 py-1 rounded-md bg-purple-50 border border-purple-200 text-xs font-bold text-purple-700">
                        {formatFtsCitation(f.labels)}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">
                        → {f.username}
                        {f.isStar && " ⭐"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 优秀奖：未获金银铜、解出至少 1 题的队伍 */}
        <div className="p-4 border border-gray-200 rounded-lg">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-800 cursor-pointer">
              <input
                type="checkbox"
                checked={excellenceEnabled}
                onChange={(e) => setExcellenceEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              优秀奖（未获金银铜、但解出至少 1 题的队伍）
            </label>
            <input
              className={inputClass + " w-40"}
              placeholder="优秀奖"
              disabled={!excellenceEnabled}
              value={excellenceCitation}
              onChange={(e) => setExcellenceCitation(e.target.value)}
            />
          </div>
          {excellenceEnabled && (
            <div className="mt-3">
              <p className="text-xs font-bold text-gray-600 mb-1.5">
                预览：将生成{" "}
                <span className="text-blue-600">
                  {excellencePreview.length}
                </span>{" "}
                个奖（一个奖项事件包含全部队伍）
              </p>
              {excellencePreview.length === 0 ? (
                <p className="text-sm text-gray-400">
                  没有未获金银铜且解出题目的队伍。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {excellencePreview.slice(0, 8).map((t) => (
                    <span
                      key={t.username}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700"
                    >
                      {(excellenceCitation.trim() || "优秀奖") + " · "}
                      <span className="font-mono text-emerald-600">
                        {t.username}
                      </span>
                    </span>
                  ))}
                  {excellencePreview.length > 8 && (
                    <span className="text-xs text-gray-400 self-center">
                      …等 {excellencePreview.length} 队
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 冠军/亚军/季军：按学校去重 */}
        <div className="p-4 border border-gray-200 rounded-lg">
          <label className="flex items-center gap-2 text-sm font-bold text-gray-800 cursor-pointer">
            <input
              type="checkbox"
              checked={topThreeEnabled}
              onChange={(e) => setTopThreeEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            冠军 / 亚军 / 季军（按学校去重：每个学校最多一个席位，取该校最好队伍）
          </label>
          {topThreeEnabled && (
            <div className="mt-3 space-y-2">
              {topThreePreview.map((seat) => (
                <div key={seat.key} className="flex flex-wrap items-center gap-3">
                  <input
                    className={inputClass + " w-40"}
                    placeholder={seat.label}
                    value={top3Citations[seat.key as keyof typeof top3Citations]}
                    onChange={(e) =>
                      setTop3Citations((prev) => ({
                        ...prev,
                        [seat.key]: e.target.value,
                      }))
                    }
                  />
                  <span className="text-sm text-gray-600">
                    {seat.team
                      ? `→ ${seat.team.username}${
                          seat.team.displayName
                            ? ` (${seat.team.displayName})`
                            : ""
                        } · ${seat.team.school || "无学校"}`
                      : "→ 学校数不足，暂无队伍"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 榜单预览 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-gray-800">3. 榜单预览（实时反映上方设置）</h3>
          <span className="text-xs text-gray-400">
            打星队伍不参与奖项 · 并列名次按排行榜页口径
          </span>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="bg-gray-50 text-gray-700 font-bold border-b uppercase text-xs sticky top-0">
              <tr>
                <th className="px-4 py-2.5">Rank</th>
                <th className="px-4 py-2.5">Team</th>
                <th className="px-4 py-2.5">School</th>
                <th className="px-4 py-2.5">Solved</th>
                <th className="px-4 py-2.5">Penalty</th>
                <th className="px-4 py-2.5">Award</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.map((t) => (
                <tr key={t.username} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono">{t.rank}</td>
                  <td className="px-4 py-2">
                    <span className="font-medium text-gray-900">
                      {t.username}
                      {t.isStar && (
                        <span className="ml-1 text-xs text-gray-400">⭐</span>
                      )}
                    </span>
                    {t.displayName && (
                      <span className="text-xs text-gray-400 ml-2">
                        {t.displayName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{t.school || "—"}</td>
                  <td className="px-4 py-2 font-mono">{t.solved}</td>
                  <td className="px-4 py-2 font-mono">{t.penalty}</td>
                  <td className="px-4 py-2">
                    {t.medal ? (
                      medalChip(t.medal)
                    ) : t.isStar ? (
                      <span className="text-xs text-gray-400">
                        打星（不参与奖项）
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {preview.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    No teams in this contest.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 自定义奖项 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-800">4. 自定义奖项（可选）</h3>
          <button
            onClick={addCustom}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-md border border-blue-200 hover:bg-blue-50"
          >
            <PlusIcon className="w-4 h-4" />
            添加奖项
          </button>
        </div>

        {custom.length === 0 && (
          <p className="text-sm text-gray-400 mb-2">
            例如：最佳女队、顽强拼搏奖……用搜索框查找并勾选队伍。
          </p>
        )}

        <div className="space-y-3">
          {custom.map((a, index) => (
            <div
              key={index}
              className="flex flex-col md:flex-row gap-3 items-start p-3 border border-gray-200 rounded-lg bg-gray-50/50"
            >
              <div className="flex-1 min-w-0">
                <label className={labelClass}>奖项名称（citation）</label>
                <input
                  className={inputClass + " w-full"}
                  placeholder="例如：最快解题奖"
                  value={a.citation}
                  onChange={(e) =>
                    updateCustom(index, { citation: e.target.value })
                  }
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className={labelClass}>
                  获奖队伍（已选 {a.teamIds.length} 支）
                </label>
                <TeamMultiSelect
                  teams={teamOptions}
                  selected={a.teamIds}
                  onChange={(next) => updateCustom(index, { teamIds: next })}
                />
              </div>
              <button
                onClick={() => removeCustom(index)}
                className="mt-5 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                title="删除该奖项"
              >
                <TrashIcon className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 导出开关 + 说明 */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-6">
        <label className="flex items-center gap-2 text-sm font-bold text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          导出 Event Feed 时包含奖项（awards 事件）
        </label>

        <div className="mt-3 text-sm text-gray-700">
          {awardSummary ? (
            <p>
              当前配置将生成{" "}
              <span className="font-bold text-blue-600">
                {awardSummary.total}
              </span>{" "}
              个奖项事件（{awardSummary.parts.join(" · ")}）
            </p>
          ) : (
            <p className="text-amber-600 font-bold">
              奖项未启用，导出将不包含任何奖项
            </p>
          )}
        </div>

        <div className="mt-4 p-4 bg-blue-50 border-l-4 border-blue-400 rounded text-sm text-blue-900 space-y-1.5">
          <p className="flex items-center gap-1.5 font-bold">
            <InformationCircleIcon className="w-4 h-4" />
            使用说明（ICPC Tools resolver 滚榜）
          </p>
          <p>
            1. 在本页设置奖项后点击「导出 Event Feed」——若有未保存的修改，
            导出前会<b>自动先保存</b>；
          </p>
          <p>
            2. 下载的文件名为 event-feed-contest-&lt;id&gt;-&lt;时间&gt;.ndjson，
            请打开<b>刚下载的这份</b>（不要打开旧的同名文件）；
          </p>
          <p>
            3. 用 ICPC Tools resolver 打开该文件：奖项会在滚榜的
            <b>最后阶段</b>逐个公布（金 → 银 → 铜 → 冠亚季 → 一血 → Solved
            → 自定义），请耐心滚到最后；
          </p>
          <p>
            4. 想快速核对：用文本编辑器打开 ndjson，搜索{" "}
            <code className="bg-blue-100 px-1 rounded">awards</code>{" "}
            （奖项事件）或奖项名（如“冠军”）即可确认已导出。奖项事件格式与
            ICPC Tools award 工具一致（带 parameters，金银铜各有
            display_mode=list 副本）。
          </p>
        </div>
      </div>
    </div>
  );
}
