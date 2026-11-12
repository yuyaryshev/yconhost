# Windows cmd launch quoting

`cmd.exe /K` and `/C` consume a command string, not ordinary Windows argv.
Passing the command as a node-pty argv element applied CommandLineToArgvW
escaping: embedded `"` became `\"`. Thus even a valid `cd /d "D:\project"`
failed with `The filename, directory name, or volume label syntax is incorrect`.
The Codex executable was never reached; Markdown and cwd were correct.

At the actual PTY boundary, `ptyArguments` now uses a raw command line for cmd
with `/S` and one outer quote pair around the command. cmd strips that pair
and receives the original inner quotes unchanged. Both standard ConPTY and
yopenconsole workers use this helper. Other executables keep argv escaping;
bare interactive cmd without a command remains unchanged. HTTP/MCP records
and terminal-host messages still use the existing `string[]` argument contract.

Regression coverage: plain/unit command serialization, quoted cd into a folder
containing spaces and `&`, quoted executable at the start of a command, quoted
arguments, and actual execution/exit on both Windows backends.

For a running yopenconsole host, newly started sessions load the updated worker
from disk; terminal host and unrelated sessions do not need to restart. Standard
ConPTY code is loaded in the host itself and takes effect on its next planned
restart. Restart only the affected failed shell after rebuilding, not all sessions.

Verified 2026-11-12: typecheck/build and all 141 tests (23 files) pass. After
building, only `symcode_lite_goal` was restarted through its existing HTTP API.
Its live WebSocket snapshot shows the resumed Codex TUI, the expected working
directory, session ID and YOLO permissions. Two other running consoles retained
their PIDs. Neither the HTTP server nor terminal host needed a restart; no PM2
recovery operations or source Markdown edits were performed.
