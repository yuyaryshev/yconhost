import headless from "@xterm/headless";
import { afterEach, expect, it } from "vitest";
import { currentScreenText } from "../src/client/terminalScreen.js";

const terminals: InstanceType<typeof headless.Terminal>[] = [];
function terminal(cols = 12, rows = 4) {
  const value = new headless.Terminal({ cols, rows, scrollback: 20, allowProposedApi: true });
  terminals.push(value);
  return value;
}
const write = (value: ReturnType<typeof terminal>, data: string) => new Promise<void>((resolve) => value.write(data, resolve));
afterEach(() => { for (const value of terminals.splice(0)) value.dispose(); });

it("joins soft-wrapped IDs but preserves real newlines and blank rows", async () => {
  const value = terminal();
  const id = "019b82b0-2182-7c91-934b-2ab25d86de9a";
  await write(value, `${id}\r\nEND`);
  expect(currentScreenText(value)).toBe(`${id}\nEND`);
});

it("keeps spaces at a soft wrap and handles wide-character padding", async () => {
  const spaced = terminal(6, 3);
  await write(spaced, "abcde fghi");
  expect(currentScreenText(spaced)).toBe("abcde fghi\n");
  const wide = terminal(6, 3);
  await write(wide, "abcde\u4e2df");
  expect(currentScreenText(wide)).toBe("abcde\u4e2df\n");
});

it("captures only the current viewport without earlier scrollback or ANSI escapes", async () => {
  const value = terminal(20, 3);
  await write(value, "OLD\r\nOLD2\r\n\x1b[31mFIRST\x1b[0m\r\n\r\nLAST");
  expect(currentScreenText(value)).toBe("FIRST\n\nLAST");
  value.scrollToTop();
  expect(currentScreenText(value)).toBe("OLD\nOLD2\nFIRST");
});

it("uses the TUI alternate screen, stays frozen as a string and never changes terminal state", async () => {
  const value = terminal(20, 4);
  await write(value, "normal\x1b[?1049h\x1b[H\x1b[32mTUI\x1b[0m\r\nSession: demo");
  const before = { x: value.buffer.active.cursorX, y: value.buffer.active.cursorY, type: value.buffer.active.type };
  const text = currentScreenText(value);
  expect(text).toBe("TUI\nSession: demo\n\n");
  expect(text).not.toContain("normal");
  expect({ x: value.buffer.active.cursorX, y: value.buffer.active.cursorY, type: value.buffer.active.type }).toEqual(before);
  await write(value, "\x1b[HNEW");
  expect(text).toContain("TUI");
  expect(currentScreenText(value)).toContain("NEW");
  await write(value, "\x1b[?1049l");
  expect(currentScreenText(value)).toContain("normal");
});
