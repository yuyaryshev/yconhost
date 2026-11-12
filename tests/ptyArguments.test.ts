import { expect, it } from "vitest";
import { ptyArguments } from "../src/server/ptyArguments.js";

it("preserves cmd command quotes instead of applying argv escaping", () => {
  const command = 'cls && title session && cd /d "D:\\project & spaces" && ycodex resume session';
  expect(ptyArguments("cmd.exe", ["/K", command], "win32")).toBe(`/S /K "${command}"`);
  expect(ptyArguments("C:\\Windows\\System32\\cmd.exe", ["/d", "/s", "/c", command], "win32")).toBe(`/d /s /c "${command}"`);
  expect(ptyArguments("CMD", ["/d", "/q", "/k", '"D:\\Program Files\\tool.exe" "file name"'], "win32")).toBe('/d /q /S /k ""D:\\Program Files\\tool.exe" "file name""');
});

it("leaves ordinary executable argv, non-Windows shells and interactive cmd unchanged", () => {
  for (const [shell, args, platform] of [
    ["node.exe", ["script file.js", 'a"b'], "win32"],
    ["powershell.exe", ["-Command", 'Write-Output "text"'], "win32"],
    ["cmd.exe", ["/d", "/k"], "win32"],
    ["bash", ["-lc", 'echo "text"'], "linux"]
  ] as const) {
    const original = [...args];
    expect(ptyArguments(shell, original, platform)).toBe(original);
  }
});
