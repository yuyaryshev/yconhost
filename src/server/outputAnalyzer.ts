import type { ConsoleStatus, TrackerResult } from "./types.js";

const redAnsiPattern = /\x1b\[(?:[0-9;]*;)?(?:31|91|38;5;(?:1|9|88|124|160|196))m/i;
const errorWordPattern = /\berrors?\b/gi;

export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function analyzeOutput(tail: string, ansiParserEnabled: boolean, previousErrorCount = 0): TrackerResult {
  const plain = stripAnsi(tail);
  const matches = [...plain.matchAll(errorWordPattern)].filter((match) => {
    const wordStart = match.index ?? 0;
    const left = plain.slice(Math.max(0, wordStart - 16), wordStart).trimEnd();
    const right = plain.slice(wordStart + match[0].length, wordStart + match[0].length + 16).trimStart();
    return !/\bno\s*$/i.test(left) && !/^[:=\s-]*0\b/.test(right);
  });

  const redSegments = ansiParserEnabled && redAnsiPattern.test(tail) ? 1 : 0;
  const errorCount = previousErrorCount + matches.length + redSegments;
  const status: ConsoleStatus = errorCount > previousErrorCount ? "ready" : "running";
  return { status, errorCount };
}
