import { expect, it } from "vitest";
import { isWindowsTerminalReply } from "../src/client/terminalInput.js";

it("does not inject Windows terminal reports into command input", () => {
  for (const reply of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[O", "\x1b[I", "\x1b]10;rgb:e8e8/ecec/efef\x1b\\", "\x1b]11;rgb:0000/1919/3232\x07"]) {
    expect(isWindowsTerminalReply("cmd.exe", reply)).toBe(true);
    expect(isWindowsTerminalReply("/bin/bash", reply)).toBe(false);
  }
  for (const input of ["echo hello\r", "\x1b[A", "\x03", "ycodex resume thread\r", "\x1b[200~pasted text\x1b[201~"]) {
    expect(isWindowsTerminalReply("cmd.exe", input)).toBe(false);
  }
});
