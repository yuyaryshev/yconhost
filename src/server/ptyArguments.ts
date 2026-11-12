import path from "node:path";

export function ptyArguments(shell: string, args: string[], platform: NodeJS.Platform = process.platform): string[] | string {
  if (platform !== "win32" || !/^cmd(?:\.exe)?$/i.test(path.win32.basename(shell))) return args;
  const commandIndex = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
  if (commandIndex < 0 || commandIndex === args.length - 1) return args;
  const switches = args.slice(0, commandIndex);
  if (!switches.some((arg) => /^\/s$/i.test(arg))) switches.push("/S");
  // cmd /S removes these outer quotes, leaving the command's inner quotes unchanged.
  // A raw PTY command line avoids CommandLineToArgvW's incompatible backslash escapes.
  return `${[...switches, args[commandIndex]].join(" ")} "${args.slice(commandIndex + 1).join(" ")}"`;
}
