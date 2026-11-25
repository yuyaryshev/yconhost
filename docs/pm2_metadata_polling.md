# PM2 Metadata Polling Without Periodic WMIC

## Cause

The first RPC implementation removed yconhost's CLI children but polled
`getMonitorData` every two seconds. In installed PM2 6.0.14 that method calls
`pidusage`, which starts WMIC inside the daemon on Windows. Checking only the
yconhost PID missed this side effect. CPU/RAM values are not used by our UI.

Evidence supplied by the user:
`D:\b\Mine\GIT_Work\ywinmon\runtime\incidents\20261125-070236-983140ef\report.md`.

## Strategy

This PM2 version exposes no metadata-only full inventory RPC. Subscribe to
the process event bus first, then fetch an initial `getMonitorData` snapshot.
On regular polls, `getReport` verifies availability and supplies `managed_apps`
without invoking pidusage; return the cached application records. Invalidate
the snapshot on lifecycle events or a changed managed count. A changed count
also handles deletions that are not published reliably by PM2. Compare with
the previous report count, not with list length: PM2 can omit internal records
from its formatted inventory. Ignore log/metrics telemetry.

Resnapshot once per change batch or reconnect, not on a timer. An event arriving
during a snapshot keeps the cache dirty for the next poll. Any RPC/bus failure,
timeout or invalid report closes both channels and surfaces the folder error;
the platform retains the last good list. No metrics fallback for failed reports.

Initial/reconciliation snapshots can still cause a single WMIC via PM2. Normal
unchanged-list polling cannot. PM2's own periodic worker and other clients
(including pm2-logrotate) may independently use pidusage; their configuration
is outside this change. No daemon source patches, app restarts, resurrect or
machine startup changes are needed: deploy by reloading only the PM2 folder.

## Verification Scope

Tests must count metrics RPC calls after warmup, not merely check that our
client contains no spawn. Cover coalesced polling, lifecycle changes, missed
deletion events, snapshot races, raw count differences, reconnects and failure
of either channel. Live verification must watch both yconhost and PM2 daemon
descendants, including WMIC, while confirming inventory and user PIDs remain
unchanged. Do not interpret unrelated PM2 background metrics as yconhost polls.

The report also identifies two live PM2 daemons (22604 and 22808). Do not
repair this here; daemon recovery belongs to Windows admin drivers yuri-desktop.
