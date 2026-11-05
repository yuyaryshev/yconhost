import type { Terminal } from "@xterm/xterm";

export function currentScreenText(terminal: Pick<Terminal, "buffer" | "rows" | "cols">): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < terminal.rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row);
    const next = row + 1 < terminal.rows ? buffer.getLine(buffer.viewportY + row + 1) : undefined;
    const continued = next?.isWrapped === true;
    let text = line?.translateToString(!continued) ?? "";
    // A wide character may leave an unused cell before wrapping to the next row.
    if (continued && next?.getCell(0)?.getWidth() === 2 && line?.getCell(terminal.cols - 1)?.getCode() === 0) text = text.slice(0, -1);
    if (row > 0 && line?.isWrapped) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.join("\n");
}
