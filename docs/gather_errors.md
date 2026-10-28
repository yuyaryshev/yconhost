# Gather Errors

The session toolbar has a Gather errors switch immediately before Mark read.
It enables/disables server-side extraction of all diagnostic cards (errors,
warnings and informational messages), not terminal output or text-log storage.

## Defaults and Overrides

- Sessions inherit their project's default unless explicitly overridden.
- Projects default to enabled. The codexes project (case-insensitive), including
  Claude slots, and the configured Codex-context project default to disabled.
- Existing sessions without an override inherit these defaults on upgrade too.
- The project menu's Gather errors by default checkbox updates inherited sessions
  and future sessions. Explicit session choices are preserved.
- Changing the session switch saves an override. The adjacent reset arrow restores
  inheritance; its tooltip is Use project default.
- Defaults are saved in managed-projects.json; session overrides in consoles.json.
  Start, Restart, mywins reload and context reimport preserve the override.
- PM2's read-only log views do not collect diagnostic cards and have no switch.

Disabling clears displayed cards and counters immediately and cancels pending
extraction. No card parsing is scheduled for subsequent output. Text logs remain
intact; enabling again extracts cards from the retained log using the usual limits
and existing Mark read acknowledgements.

## API and MCP

- POST /api/consoles/:id/gather-errors with {"enabled":true|false|null}.
  null removes the session override.
- POST /api/projects/:project/gather-errors with {"enabled":true|false}.
- MCP set_console_gather_errors(id, enabled) and
  set_project_gather_errors(project, enabled) expose the same behavior.
- Session state/snapshots include effective gatherErrors and optional
  gatherErrorsOverride. Project summaries include their effective gatherErrors.

These controls never start, stop or restart processes. Applying the server upgrade
does require a coordinated service restart; its existing no-autostart policy stays
unchanged.

## Verification and Deployment, 2026-10-28

- All 47 tests and the production build passed. Coverage includes disabled-parser
  scheduling, pending extraction cancellation, retained input/output/logs,
  inherited defaults, explicit overrides, restart/reimport and HTTP/MCP validation.
- An isolated PM2 instance on port 4012 verified real diagnostic cards disappearing
  and counters reaching zero without a shell PID change. Chrome verified the switch
  before Mark read, project defaults, reset-to-inheritance, dark/light themes and
  non-overlapping controls at 390x844. No browser warnings/errors were reported.
- After user approval, the live service was stopped and started through PM2.
  State backups were saved under data/before-gather-errors-1793186232869. Existing
  in-memory Mark read keys were compacted and merged after shutdown to accommodate
  the older backend's persistence omission. All previous slots/acknowledgements
  survived; startup sync added one newly available context.
- The live API verified 82 codexes slots with gathering disabled and zero error
  counters, the normal Default project enabled, and no auto-started processes.
  Chrome verified khb_microservices_claude with the switch off and zero cards.
- The verification PM2 process was removed and the final PM2 process list saved.
  For coordinated Windows upgrades, use explicit stop/start and confirm the port
  is free before starting; verify that its listening PID matches PM2 afterward.
