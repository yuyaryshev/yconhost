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
