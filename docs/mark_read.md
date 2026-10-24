# Mark Read

Mark read acknowledges all current cards (error, warning, info and message).
Acknowledged cards disappear from the attention feed and its severity counts.
The underlying console log and extracted history are not deleted. The snapshot
API retains all cards and includes a per-card `read` flag. Existing
`readCardHashes` continue to identify acknowledgements across restarts.
The console store saves those hashes with each definition (previously omitted).
Keys are fixed-length SHA-256 fingerprints, not full diagnostic text. Legacy
text-based keys are converted on load while preserving card IDs and read state.

The browser uses both the card flag and the latest console record's read hashes,
so a stale card snapshot cannot keep an acknowledged diagnostic visible.
This also supports an older running server that only provides read hashes,
allowing the UI fix to be deployed without restarting active terminals.
After an explicit Mark read, the selected console's card snapshot is refreshed.

Before acknowledging, the backend flushes a pending debounced card extraction.
Otherwise output received just before the click could be extracted afterward
and incorrectly appear unread. Output received after acknowledgement remains
eligible to create new unread cards.

Regression coverage checks the debounce race, all severity counts, older-server
compatibility, new errors after acknowledgement, project-wide Mark read, log
retention and acknowledgement persistence across a server restart.

## Verification And Activation

2026-10-24: all 38 tests and the production build passed. Chrome verified that
`odbp_requirements` has no visible acknowledged cards and zero severity counts.
An isolated PM2 server verified an actual error card disappearing on Mark read,
unchanged shell PID, retained raw output, and retained acknowledgement after
server restart. Legacy read keys also migrated to 71-character fingerprints.

The frontend fix is served by the live instance without restarting it. Backend
debounce/persistence changes take effect on its next coordinated restart.
When upgrading a server that omitted read hashes from its store, capture the live
records' `readCardHashes` through the API **before** stopping it, then merge those
keys into the matching saved definitions **after** shutdown and before starting
the new server. The old shutdown code would otherwise discard in-memory read
state. Keep a backup of the definition file and do not clear console logs.
