# Mark Read

Mark read acknowledges all current cards (error, warning, info and message).
Acknowledged cards disappear from the attention feed and its severity counts.
The underlying console log and extracted history are not deleted. The snapshot
API retains all cards and includes a per-card `read` flag. Existing
`readCardHashes` continue to identify acknowledgements across restarts.

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
