import crypto from "node:crypto";
import type { ConsoleStatus, ErrorMatch, TrackerResult } from "./types.js";

const redAnsiPattern = /\x1b\[(?:[0-9;]*;)?(?:31|91|38;5;(?:1|9|88|124|160|196))m/i;
const errorWordPattern = /\berrors?\b/gi;

export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function analyzeOutput(tail: string, ansiParserEnabled: boolean, previousErrorCount = 0): TrackerResult {
  const plain = stripAnsi(tail);
  const now = new Date().toISOString();
  const matches: ErrorMatch[] = [];

  for (const line of plain.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const wordMatches = [...line.matchAll(errorWordPattern)].filter((match) => {
      const wordStart = match.index ?? 0;
      const left = line.slice(Math.max(0, wordStart - 16), wordStart).trimEnd();
      const right = line.slice(wordStart + match[0].length, wordStart + match[0].length + 16).trimStart();
      return !/\bno\s*$/i.test(left) && !/^[:=\s-]*0\b/.test(right);
    });
    for (const match of wordMatches) {
      matches.push({ id: crypto.randomUUID(), createdAt: now, line, reason: `matched word "${match[0]}"` });
    }
  }

  if (ansiParserEnabled) {
    for (const rawLine of tail.split(/\r?\n/).filter(Boolean)) {
      if (redAnsiPattern.test(rawLine)) {
        matches.push({ id: crypto.randomUUID(), createdAt: now, line: stripAnsi(rawLine).trim(), reason: "matched red ANSI output" });
      }
    }
  }

  const errorCount = previousErrorCount + matches.length;
  const status: ConsoleStatus = errorCount > previousErrorCount ? "ready" : "running";
  return { status, errorCount, matches };
}
