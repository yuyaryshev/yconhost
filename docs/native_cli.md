# Native CLI windows

The optional Windows `yopenconsole` backend exposes the same running console through
ConPTY and a real native window. It starts hidden. The console toolbar toggles
"Show native cli" / "Hide native cli"; the native close button and Alt+F4 hide it,
without terminating the shell. Browser input and native input share the console's
actual input queue. No local/optimistic input echo is added.

## Configuration

Preferences stores these fields in `settings.json5`:

```json5
{
  terminal: {
    host: "yopenconsole", // "standard" retains the existing backend
    yopenconsolePath: "D:\\b\\Mine\\GIT_Work\\yopenconsole\\bin\\x64\\Release\\yopenconsole.exe",
  },
}
```

The host choice applies to newly started/restarted consoles only; existing sessions
keep their backend. PM2 read-only consoles do not expose this action. Starting the
service still restores idle slots only, never launches their commands.

When the native window is visible, its viewport owns the dimensions; browser
resize requests are remembered but not applied to the host. Hiding the window
returns sizing to the browser. Native resize testing is intentionally omitted at
the user's request.

## Implementation

Each yopenconsole terminal runs node-pty in an isolated hidden worker. A versioned
runtime under `<dataDir>/native-runtimes` contains node-pty's pinned native addon
and DLL, and the configured executable staged as the required sibling name
`OpenConsole.exe`. No system files or shared node_modules binaries are replaced.
Standard and yopenconsole sessions can coexist. Shell/process-tree termination,
native handle release and output-worker disposal follow the existing cleanup rules.
Loss of the server IPC connection also tears down the worker's console.

The host receives a unique `YOPENCONSOLE_PIPE_ID` in its environment. Its control
pipe is serialized and used for `close-mode hide`, `show`, `hide`, `visible`, and
`size`. Visibility is refreshed every 250 ms, including changes from the native
close button; UI records include `nativeCli: { visible, cols, rows }`.
Raw ConPTY output alone feeds the normal log, cards, MCP and WebSocket stream.
Control-pipe screen snapshots are not appended to the log.

HTTP endpoints for managed running yopenconsole sessions:

- `GET /api/consoles/:id/native` returns actual visibility and viewport dimensions.
- `POST /api/consoles/:id/native` with `{ "visible": true | false }` shows/hides
  the window and returns confirmed state. Standard/stopped sessions return an error.

An interactive Windows desktop is required to use the native window. Default pipe
ACLs apply. Missing/incompatible custom executables produce a console startup error,
not a silent fallback to another backend.
