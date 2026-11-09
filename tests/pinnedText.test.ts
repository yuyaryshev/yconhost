import { expect, it } from "vitest";
import { expandPinnedText, pinnedTextParts } from "../src/client/pinnedText.js";

it("expands only named literal substitutions without eval or inherited lookups", () => {
  const values = { work_dir: "D:\\project with spaces", session_id: "id-123", literal: "{{session_id}}" };
  expect(expandPinnedText("{{ work_dir }}\n{{session_id}} {{unknown}} {{toString}} {{literal}}", values))
    .toBe("D:\\project with spaces\nid-123 {{unknown}} {{toString}} {{session_id}}");
});

it("preserves all text while detecting Windows paths, UNC, spaces and web links", () => {
  const text = 'Work: "D:\\My Project\\src"\n`\\\\host\\share\\path with spaces`\nFile d:\\abc\\def.txt, https://example.com/path?q=1&x=2.';
  const parts = pinnedTextParts(text);
  expect(parts.map((part) => part.text).join("")).toBe(text);
  expect(parts.filter((part) => part.kind === "path").map((part) => part.text)).toEqual(["D:\\My Project\\src", "\\\\host\\share\\path with spaces", "d:\\abc\\def.txt"]);
  expect(parts.filter((part) => part.kind === "url").map((part) => part.text)).toEqual(["https://example.com/path?q=1&x=2"]);
});

it("does not turn unsafe schemes, markup or relative text into executable links", () => {
  const text = '<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,hi ./file.md';
  expect(pinnedTextParts(text)).toEqual([{ kind: "text", text }]);
});
