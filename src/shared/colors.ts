export const standardColors: Record<string, readonly [number, number, number]> = {
  STD_BLACK: [0, 0, 0], STD_RED: [1, 0, 0], STD_GREEN: [0, 1, 0], STD_BLUE: [0, 0, 1],
  STD_YELLOW: [1, 1, 0], STD_CYAN: [0, 1, 1], STD_MAGENTA: [1, 0, 1], STD_WHITE: [1, 1, 1]
};

export function colorRgb(value: string, theme: "dark" | "light" = "dark"): [number, number, number] | undefined {
  const raw = value.trim();
  const key = raw.toUpperCase().replace(/^STD_GR(?:AY|EY)$/, "STD_WHITE");
  const channels = standardColors[key];
  if (channels) return channels.map((enabled) => theme === "dark" ? enabled ? 20 : 12 : enabled ? 255 : 247) as [number, number, number];
  const hex = raw.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
  const rgb = raw.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i) ?? raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!rgb) return undefined;
  const parsed = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as [number, number, number];
  return parsed.every((channel) => channel >= 0 && channel <= 255) ? parsed : undefined;
}

export function resolveConsoleBackground(value?: string): { dark: string; light: string } | undefined {
  if (!value?.trim()) return undefined;
  const dark = colorRgb(value, "dark");
  const light = colorRgb(value, "light");
  return dark && light ? { dark: `rgb(${dark.join(", ")})`, light: `rgb(${light.join(", ")})` } : undefined;
}

export function colorHex(value: string, theme: "dark" | "light" = "dark"): string {
  const rgb = colorRgb(value, theme) ?? [17, 19, 22];
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
