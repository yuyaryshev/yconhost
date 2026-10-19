export function isWindowsTerminalReply(shell: string, data: string): boolean {
  if (!/(?:^|[\\/])(?:cmd|powershell|pwsh)(?:\.exe)?$/i.test(shell)) return false;
  // ConPTY handles device reports itself. Replaying browser reports feeds them to the prompt.
  return /^\x1b\[(?:\?|>)[\d;]*c$/.test(data)
    || /^\x1b\[[IO]$/.test(data)
    || /^\x1b\](?:10|11|12);rgb:[\da-f/]+(?:\x07|\x1b\\)$/i.test(data);
}
