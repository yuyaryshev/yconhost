# Closing and Deleting Consoles

## Default

Default consoles are disposable registrations, not mywins.json entries.
The list's X action is available for running, idle and exited consoles and is
labelled Delete console. In the detail toolbar, stopped consoles have a Delete
button; running consoles retain Close. The console menu also offers Delete console.
All these actions use the existing DELETE /api/consoles/:id endpoint: stop the
process if necessary and remove the registration from persisted console state.
Deleted slots do not return after a service restart.

## Projects Backed by mywins.json

- Close only stops a running console, retaining its configured slot.
- Console actions menus in both the list and detail toolbar expose Settings and
  Delete from mywins.json, even for stopped consoles.
- Delete asks for confirmation naming the console and project directory and
  warning that any running process will be stopped. Cancelling sends no request.
- Confirmed deletion uses DELETE /api/consoles/:id/mywins, removes the entry from
  the source file, stops/removes the session and refreshes the list. Both
  mywins.json and the legacy my_wins.json filename are supported.
- Other entries and top-level configuration fields remain intact. Reloading the
  project does not recreate the deleted entry. Write failures are shown as errors.

Read-only PM2 rows have no deletion actions. File-deletion actions are not offered
for MCP-managed or imported agent projects that have no mywins.json source.

This UI change uses existing server endpoints and needs no service restart.

## Verification, 2026-10-28

- All 52 tests and the production build passed. New API regressions cover removal
  of idle/exited/running Default slots from persisted state and project deletion
  in both supported source filenames without changing sibling slots or metadata.
- Chrome on an isolated PM2 server verified Default's idle-row deletion, project
  cancellation leaving the file untouched, and confirmed idle/running project
  deletion through list/detail menus. The running process exited, and unrelated
  source entries remained intact.
- Desktop and 390x844 screenshots verified menu visibility. Toolbar button styles
  now apply only to direct controls, so the menu icon retains its full width and
  menu items do not inherit toolbar borders/padding. No browser warnings/errors.
- The temporary server was removed and port 4012 released. The live server's PID
  was unchanged; only rebuilt static UI assets were updated. Reload the browser
  to activate the new controls.
