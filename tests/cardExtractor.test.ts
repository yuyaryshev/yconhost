import { describe, expect, it } from "vitest";
import { extractCardsFromText, stripAnsi } from "../src/server/cardExtractor.js";

describe("card extractor", () => {
  it("strips ANSI sequences", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m")).toBe("error");
  });

  it("extracts cards and excludes no errors", () => {
    const cards = extractCardsFromText("Build complete, no errors\nBuild error in file\nwarning deprecated API\n", 20);
    expect(cards.map((card) => card.category)).toEqual(["error", "warning"]);
    expect(cards[0].title).toBe("Build error in file");
  });

  it("deduplicates normalized blocks", () => {
    const cards = extractCardsFromText("Error: failed\n\nError:   failed\n", 20);
    expect(cards).toHaveLength(1);
  });

  it("deduplicates repeated diagnostics by first significant line", () => {
    const message = 'Warning: Error occurred while processing file src\\ui\\pages\\test_page\\index.tsx: SyntaxError: Unexpected token, expected "," (28:27)';
    const cards = extractCardsFromText(`${message}\nfirst detail\n\n${message}\nsecond detail\n`, 20);
    expect(cards).toHaveLength(1);
    expect(cards[0].message).toContain("first detail");
  });

  it("keeps long diagnostic lines intact", () => {
    const longLine = `Error: ${"x".repeat(220)}`;
    const cards = extractCardsFromText(`${longLine}\n`, 20);
    expect(cards[0].message).toBe(longLine);
  });

  it("unwraps terminal hard-wrapped diagnostic lines with duplicated boundary chars", () => {
    const cards = extractCardsFromText(`Warning: ${"x".repeat(100)} Unexpected token, ex\nxpected comma\n    at parser.js:1:1\n`, 20);
    expect(cards[0].message).toContain("Unexpected token, expected comma");
  });

  it("treats warning before error as warning severity", () => {
    const cards = extractCardsFromText("Warning: Error boundary fallback was used\nError: hard failure\n", 20);
    expect(cards.map((card) => card.category)).toEqual(["warning", "error"]);
  });
});
