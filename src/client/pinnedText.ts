export function expandPinnedText(text: string, variables: Record<string, string> = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (token, name: string) => Object.hasOwn(variables, name) && typeof variables[name] === "string" ? variables[name] : token);
}

export interface PinnedTextPart {
  kind: "text" | "path" | "url";
  text: string;
}

export function pinnedTextParts(text: string): PinnedTextPart[] {
  const result: PinnedTextPart[] = [];
  const pattern = /(["`])((?:[a-z]:[\\/]|\\\\)[^"`\r\n]+)\1|https?:\/\/[^\s<>"`]+|(?<![\w])(?:[a-z]:[\\/]|\\\\)[^\s<>"`()\[\]{}]+/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const quoted = Boolean(match[1]);
    const start = match.index! + (quoted ? 1 : 0);
    const value = quoted ? match[2] : match[0].replace(/[.,;!?)\]}]+$/, "");
    if (start > offset) result.push({ kind: "text", text: text.slice(offset, start) });
    result.push({ kind: /^https?:\/\//i.test(value) ? "url" : "path", text: value });
    offset = start + value.length;
  }
  if (offset < text.length) result.push({ kind: "text", text: text.slice(offset) });
  return result;
}
