import crypto from "node:crypto";
import type { ExtractedCard, ExtractedCardCategory } from "./types.js";

const errorPattern = /\b(error|errors|exception|failed|failure|fatal|traceback)\b/i;
const warningPattern = /\b(warn|warning|deprecated)\b/i;
const infoPattern = /\b(info|notice|success|done|complete|completed)\b/i;

export function extractCardsFromText(input: string, limit: number): ExtractedCard[] {
  const plain = unwrapHardWrappedLines(stripAnsi(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const cards: ExtractedCard[] = [];
  const seen = new Set<string>();

  for (const block of groupBlocks(plain)) {
    const category = classify(block);
    if (!category) continue;
    const hash = `${category}:${dedupeKey(block)}`;
    if (seen.has(hash)) continue;
    seen.add(hash);
    cards.push({
      id: crypto.createHash("sha1").update(hash).digest("hex"),
      kind: "persistent",
      category,
      title: titleFor(block, category),
      message: block,
      rawText: block,
      hash,
      createdAt: new Date().toISOString()
    });
  }

  return cards.slice(-limit);
}

export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function mergeCards(persistent: ExtractedCard[], temporary: ExtractedCard[], limit: number): ExtractedCard[] {
  const byHash = new Map<string, ExtractedCard>();
  for (const card of persistent) byHash.set(card.hash, card);
  for (const card of temporary) {
    if (!byHash.has(card.hash)) byHash.set(card.hash, card);
  }
  return [...byHash.values()].slice(-limit);
}

function groupBlocks(input: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of input.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) {
      pushCurrent();
      continue;
    }

    if (current.length > 0 && isContinuation(trimmed)) {
      current.push(trimmed);
      continue;
    }

    if (current.length > 0 && startsMessage(trimmed)) {
      pushCurrent();
    }
    current.push(trimmed);
  }
  pushCurrent();
  return blocks;

  function pushCurrent() {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  }
}

function unwrapHardWrappedLines(input: string): string {
  const lines = input.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const previous = output.at(-1);
    if (previous === undefined) {
      output.push(line);
      continue;
    }

    const merged = mergeHardWrap(previous, line);
    if (merged !== undefined) {
      output[output.length - 1] = merged;
    } else {
      output.push(line);
    }
  }

  return output.join("\n");
}

function mergeHardWrap(previous: string, current: string): string | undefined {
  if (!previous || !current) return undefined;
  if (previous.length < 100) return undefined;
  if (/^\s+(at|in|from|\^|File\b)/.test(current) || /^Caused by:/i.test(current)) return undefined;
  if (/[\s:;,.()[\]{}"'`<>/\\-]$/.test(previous)) return undefined;
  if (/^\s/.test(current)) return undefined;

  const first = current[0];
  if (first && previous.endsWith(first)) {
    return previous + current.slice(1);
  }
  if (/^[A-Za-z0-9_@.$/\\-]/.test(current)) {
    return previous + current;
  }
  return undefined;
}

function classify(block: string): ExtractedCardCategory | undefined {
  if (isNoError(block)) return undefined;
  const errorIndex = findIndex(block, errorPattern);
  const warningIndex = findIndex(block, warningPattern);
  if (warningIndex >= 0 && (errorIndex < 0 || warningIndex < errorIndex)) return "warning";
  if (errorIndex >= 0) return "error";
  if (infoPattern.test(block)) return "info";
  return undefined;
}

function startsMessage(line: string): boolean {
  return errorPattern.test(line) || warningPattern.test(line) || infoPattern.test(line);
}

function isContinuation(line: string): boolean {
  return /^\s+(at|in|from|\^|File\b)/.test(line) || /^Caused by:/i.test(line) || /^[-+~|>]/.test(line);
}

function isNoError(block: string): boolean {
  return /\bno\s+errors?\b/i.test(block) || /\berrors?\s*[:=-]?\s*0\b/i.test(block);
}

function findIndex(block: string, pattern: RegExp): number {
  return block.search(pattern);
}

function normalize(block: string): string {
  return block.trim().replace(/\s+/g, " ");
}

function dedupeKey(block: string): string {
  return normalize(block.split("\n").find((line) => line.trim()) ?? block);
}

function titleFor(block: string, category: ExtractedCardCategory): string {
  const first = block.split("\n")[0]?.trim() ?? category;
  return first;
}
