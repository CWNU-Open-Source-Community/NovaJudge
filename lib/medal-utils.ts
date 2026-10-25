// 奖牌计算的纯函数工具（无服务端依赖，可被客户端组件安全引用）

export interface ContestMedalConfig {
  mode: "ratio" | "fixed";
  gold: number;
  silver: number;
  bronze: number;
}

export const DEFAULT_MEDAL: ContestMedalConfig = {
  mode: "ratio",
  gold: 0,
  silver: 0,
  bronze: 0,
};

/** 与排行榜页一致的奖牌数量计算：ratio 为百分比，fixed 为固定数量 */
export function getMedalCounts(
  total: number,
  medal: ContestMedalConfig,
): { gold: number; silver: number; bronze: number } {
  const cfg = medal || DEFAULT_MEDAL;
  const mode = cfg.mode || "ratio";
  const gold = Math.max(0, Number(cfg.gold || 0));
  const silver = Math.max(0, Number(cfg.silver || 0));
  const bronze = Math.max(0, Number(cfg.bronze || 0));

  if (mode === "fixed") {
    return {
      gold: Math.min(total, Math.floor(gold)),
      silver: Math.min(total, Math.floor(silver)),
      bronze: Math.min(total, Math.floor(bronze)),
    };
  }

  return {
    gold: Math.min(total, Math.ceil((total * gold) / 100)),
    silver: Math.min(total, Math.ceil((total * silver) / 100)),
    bronze: Math.min(total, Math.ceil((total * bronze) / 100)),
  };
}

/**
 * 一血奖 citation 格式；导出时每个奖项只传入该题的标签：
 * - ["A"]                      → First to solve problem A
 * - ["A","B"]                  → First to solve problems A and B
 * - ["A","B","C","D"]          → First to solve problems A, B, C and D
 */
export function formatFtsCitation(labels: string[]): string {
  if (labels.length === 1) return `First to solve problem ${labels[0]}`;
  if (labels.length === 2)
    return `First to solve problems ${labels[0]} and ${labels[1]}`;
  return `First to solve problems ${labels.slice(0, -1).join(", ")} and ${
    labels[labels.length - 1]
  }`;
}
