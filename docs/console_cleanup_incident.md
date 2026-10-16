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
- Release node-pty after natural exit and explicit termination. The adapter includes a node-pty 1.1.0 Windows compatibility workaround: kill is otherwise deferred until first output, including for silent shells that already exited.
- Dispose terminal mirrors and scheduled card scans on removal/replacement.
- Enable PM2 shutdown messages and allow time for process-tree and native PTY cleanup.

Permanent legacy slots are retained. Names containing "temp" are not sufficient evidence to delete a user's persistent console. Newly created MCP consoles are temporary unless persistent=true is explicitly supplied; HTTP/UI creation keeps its existing persistent default.

Verification includes a real Windows PTY regression test checking host counts after repeated silent exits, immediate forced closes and interactive input, plus API tests for TTL boundaries, renewed read/output activity and restart persistence.
