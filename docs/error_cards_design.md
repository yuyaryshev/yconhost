# Error Cards Extraction Design

Status: deferred. This document captures the intended design; do not treat it as implemented behavior.

## Goal

Keep the terminal as a regular xterm.js terminal and add a separate, collapsible cards panel for extracted messages, warnings, and errors.

The cards panel must not be rendered inside xterm and must not overlay xterm. It should live outside the terminal viewport, preferably between the console toolbar and the xterm host:

```text
Console toolbar
Cards panel, collapsible
xterm host
```

## Current Implementation

The current implementation parses output on the server from raw PTY chunks:

- PTY output is appended to logs.
- `analyzeOutput(...)` scans raw chunks.
- Matching lines are stored as `errorMatches`.
- In `debugMode`, the client renders those server-side matches.

This is useful for diagnostics, but it is not the desired final architecture for UI cards because the server sees raw stdout while the browser displays xterm-rendered state.

## Desired Model

Use xterm.js as the source of truth for UI card extraction.

```text
PTY output
  -> WebSocket/fetch
  -> xterm.write(...)
  -> xterm normal buffer
       finalized scrollback -> persistent cards
       visible screen       -> temporary cards
```

Do not implement a custom terminal parser for cards. Extraction should read the already-rendered xterm buffer.

## Card Types

Cards should be split into two groups:

- `persistentCards`: messages extracted from finalized scrollback.
- `temporaryCards`: messages extracted from the current visible normal screen.

Suggested type:

```ts
type ExtractedCard = {
  id: string;
  kind: "persistent" | "temporary";
  category: "error" | "warning" | "info" | "message";
  title: string;
  message: string;
  rawText: string;
  hash: string;
  createdAt: number;
};
```

The name is intentionally broader than `ErrorCard`: the final goal is to extract all meaningful messages first, then classify them.

## xterm APIs

Use:

- `term.buffer.normal`
- `term.buffer.active`
- `term.buffer.alternate`
- `term.onWriteParsed`
- `term.rows`

All PTY output still goes through `term.write(...)` as before.

After xterm finishes parsing writes, use `term.onWriteParsed` to schedule a throttled scan. A reasonable initial throttle is 100-250 ms.

## Alternate Screen

If the active buffer is the alternate screen, do not extract cards:

```ts
if (term.buffer.active === term.buffer.alternate) {
  setTemporaryCards([]);
  return;
}
```

Persistent cards should remain unchanged. Temporary cards should disappear because alternate-screen applications frequently repaint their UI and do not represent stable log output.

## Persistent Cards

Persistent cards are created from normal-buffer lines that have already left the visible screen.

Suggested scan range:

```ts
const buffer = term.buffer.normal;
const start = lastScannedFinalY;
const end = buffer.baseY;
```

Lines below `buffer.baseY` are finalized scrollback and should be treated as immutable for extraction.

Important behavior:

- Scan only newly finalized lines.
- Add matched cards to `persistentCards`.
- Deduplicate by hash.
- Do not remove persistent cards if xterm later receives clear-screen or clear-scrollback escape sequences.
- If `buffer.baseY` becomes smaller than `lastScannedFinalY`, reset the scan cursor defensively.

## Temporary Cards

Temporary cards are rebuilt from the visible normal screen on every scan.

Suggested scan range:

```ts
const buffer = term.buffer.normal;
const start = buffer.baseY;
const end = buffer.baseY + term.rows;
```

Behavior:

- Collect visible lines into a text block.
- Run message extraction.
- Rebuild `temporaryCards` from scratch on every scan.
- Hide temporary cards that already exist in `persistentCards`.

Temporary cards may disappear when the app redraws the screen. That is expected.

## Extractor

Extraction should work on text blocks, not only on individual lines, to support stack traces and multi-line messages.

Initial grouping rules:

- A non-empty line starts or continues a message block.
- Empty lines close the current block.
- Lines matching stack-trace continuations are attached to the previous block.
- Lines beginning with whitespace plus `at` are attached to the previous block.
- Other continuation patterns can be added later.

Example:

```text
Error: Something failed
    at foo (...)
    at bar (...)
```

This should become one card.

Classification can start simple:

- `error`: contains `error`, `exception`, `failed`, `fatal`, or stack-trace-like syntax.
- `warning`: contains `warning` or `warn`.
- `info`: known informational prefixes.
- `message`: fallback category.

The extractor should return normalized cards:

```ts
type ExtractedCardDraft = {
  category: "error" | "warning" | "info" | "message";
  title: string;
  message: string;
  rawText: string;
};
```

## Deduplication

Use a stable hash:

```ts
hash = `${category}:${normalize(rawText)}`;
```

Normalization should:

- Strip repeated whitespace.
- Trim leading/trailing space.
- Optionally normalize paths and timestamps later.

Persistent cards are deduplicated against persistent cards. Temporary cards are deduplicated against persistent cards and against each other.

## UI

The card panel should be collapsible and separate from xterm.

Recommended layout:

```text
Toolbar
Cards panel
Terminal
```

Panel behavior:

- Hidden/collapsed by default or controlled by a toolbar toggle.
- Shows a total count and grouped cards.
- Has `max-height` and its own scroll.
- Does not resize individual cards based on terminal activity.
- Does not block terminal input when collapsed.

The existing `debugMode` can temporarily control this panel while the feature is experimental.

## Scrolling To Errors

Scrolling xterm to a card location is possible but should be implemented in a second phase.

Preferred approach:

- When a persistent card is created, create or store an xterm marker near the current buffer line.
- On card click, scroll to the marker line.
- Add a temporary visual highlight via xterm decorations if practical.

Avoid trying to reconstruct old positions from raw logs after the fact. Wrapped lines, ANSI state, alternate screen behavior, and scrollback trimming make that unreliable.

## Persistence

Initial implementation can be client-only. Cards will exist only while the page is open.

If persistence is needed later:

- Keep server-side raw logs as they are.
- Persist extracted card metadata separately.
- Treat client-side xterm extraction as the UI source of truth for newly observed output.
- Avoid mixing server raw-parser matches and client rendered-buffer matches as one identical source without clear labels.

## Migration Plan

1. Keep current server-side `errorMatches` for diagnostics and unread counters.
2. Add client-side xterm buffer scanner behind `debugMode`.
3. Render cards in a collapsible panel outside xterm.
4. Implement persistent and temporary card arrays on the client.
5. Add extractor and hash-based deduplication.
6. Tune grouping/classification rules on real project output.
7. Later, add xterm markers/decorations for click-to-scroll.
8. Later, decide whether card metadata should be persisted server-side.

## Risks

- xterm buffer lines are rendered/wrapped state, not original stdout lines.
- Alternate-screen apps should not produce cards.
- Client-only extraction means cards are not available until a browser observes the output.
- Server-side unread counters may not exactly match client-side cards until the architecture is unified.
- Clear scrollback can remove terminal lines while persistent cards intentionally remain visible.
