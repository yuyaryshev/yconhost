# Console host accumulation, 2026-10-16

Observed 505 Windows conhost processes, 473 owned by the yconhost server, with only 31 running console sessions. Twenty-one sessions were temporary and had no recent input, output or access. Most were shells waiting at a prompt for several days.

Causes:

- Cleanup skipped any console with a live terminal session, so temporary interactive shells could never expire.
- Closing a shell used taskkill without releasing its native PTY. Natural process exit also left PTY resources allocated.
- Restoring records reset timestamps, extending inactivity deadlines after service restart.

The service and its process tree were stopped during recovery. The total conhost count fell to 30; unrelated applications were left running.

Fixes:

- Apply the four-hour inactivity deadline to running temporary sessions too. Direct access, input and output renew the deadline; list polling does not.
- Persist creation/update timestamps along with access/input/output timestamps and prune expired temporary records on startup.
- Use node-pty's bundled ConPTY DLL on Windows. It releases the host when the shell exits; the system ConPTY path in node-pty 1.1.0 forgets the native handle before the exit callback, making later kill calls ineffective. Locally rebuilt native modules receive the bundled runtime beside their binary automatically.
- Release node-pty sockets and its output worker after exit. The adapter handles two node-pty 1.1.0 issues: kill is deferred until first output even for silent shells, and the DLL path can leave its worker waiting for output after exit.
- Dispose terminal mirrors and scheduled card scans on removal/replacement.
- Enable PM2 shutdown messages and allow time for process-tree and native PTY cleanup.

Permanent legacy slots are retained. Names containing "temp" are not sufficient evidence to delete a user's persistent console. Newly created MCP consoles are temporary unless persistent=true is explicitly supplied; HTTP/UI creation keeps its existing persistent default.

Verification includes a real Windows PTY regression test checking host counts after repeated silent exits, immediate forced closes and interactive input, plus API tests for TTL boundaries, renewed read/output activity and restart persistence.

Recovery verification:

- All 21 tests passed, including Windows host-count checks, child-process termination and output-worker release. Typecheck and production build passed.
- On the PM2-managed service, verified HTTP/UI availability, MCP temporary defaults, WebSocket input/output, session timestamps, four restarts, explicit close, natural exit and service restart with a live test shell.
- The old shell was terminated during service restart; saved slots remained idle. No consoles auto-started.
- Startup cleanup removed the 21 stale temporary slots. After removing verification slots, 317 permanent records remained, with zero running sessions and zero owned console hosts. Total system conhost count was 30.
- An isolated check using the real periodic cleanup timer and a short TTL removed a live waiting shell and confirmed its process was terminated.
- PM2 process state was saved. Legacy persistent records were retained.
