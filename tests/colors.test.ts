import { describe, expect, it } from "vitest";
import { colorHex, colorRgb, resolveConsoleBackground, terminalColorPresets } from "../src/shared/colors.js";

describe("Terminal color presets", () => {
  it("includes the actual legacy CLI background shades instead of presenting only faint STD tints", () => {
    expect(Object.values(terminalColorPresets)).toEqual([
      "#000000", "#320000", "#003200", "#000032", "#323200", "#003232", "#320032", "#323232"
    ]);
    expect(colorRgb(terminalColorPresets.CLI_GREEN)).toEqual([0, 50, 0]);
    expect(resolveConsoleBackground(terminalColorPresets.CLI_GREEN)).toEqual({ dark: "rgb(0, 50, 0)", light: "rgb(0, 50, 0)" });
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
