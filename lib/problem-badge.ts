import type { CSSProperties } from "react";

export function problemColorStyle(value: string | null, theme: "novajudge" | "domjudge" = "novajudge") {
  const color = value?.trim();
  if (!color) return;

  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return theme === "domjudge"
    ? { backgroundColor: color, color: `contrast-color(${color})` }
    : { backgroundColor: `color-mix(in srgb, ${color} 24%, white)` };

  const rgb = hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex;
  const channels = [0, 2, 4].map(offset => parseInt(rgb.slice(offset, offset + 2), 16));
  if (theme === "domjudge") {
    // DOMjudge compares black/white contrast and darkens each border channel by 64.
    const [r, g, b] = channels.map(channel => (channel / 255) ** 2.4);
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    return {
      backgroundColor: color, color: luminance ** .56 > 1 - luminance ** .65 ? "#000" : "#fff",
      borderColor: `rgb(${channels.map(channel => Math.max(0, channel - 64)).join(" ")})`,
    };
  }
  const [red, green, blue] = channels.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return { backgroundColor: color, color: luminance > 0.179 ? "#000" : "#fff" };
}

export function scoreboardBadgeStyle(color: string | null): CSSProperties {
  const badge = problemColorStyle(color || "#ffffff", "domjudge");
  return { "--badge-bg": badge?.backgroundColor, "--badge-fg": badge?.color, "--badge-border": badge?.borderColor } as CSSProperties;
}

export function attemptsLabel(count: number) {
  return count === 1 ? "1 try" : `${count} tries`;
}
