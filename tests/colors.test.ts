import { describe, expect, it } from "vitest";
import { colorHex, colorRgb, resolveConsoleBackground, terminalColorPresets } from "../src/shared/colors.js";

describe("Terminal color presets", () => {
  it("includes the actual legacy CLI background shades instead of presenting only faint STD tints", () => {
    expect(Object.values(terminalColorPresets).slice(0, 8)).toEqual([
      "#000000", "#320000", "#003200", "#000032", "#323200", "#003232", "#320032", "#323232"
    ]);
    expect(colorRgb(terminalColorPresets.CLI_GREEN)).toEqual([0, 50, 0]);
    expect(resolveConsoleBackground(terminalColorPresets.CLI_GREEN)).toEqual({ dark: "rgb(0, 50, 0)", light: "rgb(0, 50, 0)" });
  });

  it("excludes ambiguous double-19 and green intermediate shades from the 00/19/32 palette", () => {
    const expected: string[] = [];
    for (const r of ["00", "19", "32"]) for (const g of ["00", "19", "32"]) for (const b of ["00", "19", "32"]) {
      const color = `#${r}${g}${b}`;
      if ([r, g, b].includes("32") && [r, g, b].filter((channel) => channel === "19").length < 2 && !["#193200", "#003219"].includes(color)) expected.push(color);
    }
    const actual = Object.values(terminalColorPresets).filter((color) => color !== "#000000");
    expect(actual).toHaveLength(14);
    expect([...actual].sort()).toEqual(expected.sort());
    expect(new Set(Object.values(terminalColorPresets)).size).toBe(15);
    expect(actual).not.toContain("#190000");
    expect(actual).not.toContain("#191900");
    expect(actual).not.toContain("#191919");
    for (const excluded of ["#321919", "#191932", "#193219", "#193200", "#003219"]) expect(actual).not.toContain(excluded);
    expect(actual).toContain("#323219");
  });

  it("does not change existing RGB backgrounds or the independent STD palette", () => {
    expect(colorHex("STD_GREEN")).toBe("#0c140c");
    expect(colorHex("STD_GREEN", "light")).toBe("#f7fff7");
    expect(colorHex("rgb(0, 50, 0)")).toBe(terminalColorPresets.CLI_GREEN);
    for (const color of Object.values(terminalColorPresets)) {
      expect(colorHex(color)).toBe(color);
      expect(colorHex(color, "light")).toBe(color);
    }
  });
});
