import { describe, expect, it } from "vitest";
import { analyzeOutput, stripAnsi } from "../src/server/outputAnalyzer.js";

describe("output analyzer", () => {
  it("strips ANSI sequences for plain text matching", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m")).toBe("error");
  });

  it("detects error words but excludes no errors and errors 0", () => {
    expect(analyzeOutput("Build error in file", true).errorCount).toBe(1);
    expect(analyzeOutput("Build complete, no errors", true).errorCount).toBe(0);
    expect(analyzeOutput("errors 0 - successful", true).errorCount).toBe(0);
  });

  it("detects red ANSI output only when parser is enabled", () => {
    expect(analyzeOutput("\x1b[31mfailed\x1b[0m", true).errorCount).toBe(1);
    expect(analyzeOutput("\x1b[31mfailed\x1b[0m", false).errorCount).toBe(0);
  });
});
