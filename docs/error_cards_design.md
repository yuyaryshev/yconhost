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

## Backend Headless Xterm Variant

The client-only design above has an important weakness for yconhost: the real parsing and unread counters currently live on the backend, while browser xterm exists only when a UI page is open.

If extracted cards must be available server-side, the better architecture is to run a second terminal emulator on the backend in headless mode. This avoids writing a custom ANSI/VT parser and keeps the extraction based on rendered terminal state rather than raw stdout chunks.

Use the modern xterm package:

```bash
pnpm add @xterm/headless
```

Note: the older `xterm-headless` package exists, but npm marks it deprecated and recommends moving to `@xterm/headless`. Keep `@xterm/headless` version aligned with `@xterm/xterm` when possible.

Suggested backend mirror:

```ts
import { Terminal } from "@xterm/headless";

const mirror = new Terminal({
  cols: 120,
  rows: 40,
  scrollback: 10000
});

pty.onData((chunk) => {
  mirror.write(chunk);       // backend rendered state
  websocketBroadcast(chunk); // frontend xterm UI
});
```

The resulting architecture:

```text
PTY output
  -> browser xterm          // interactive UI
  -> backend headless xterm // rendered state for extraction
```

The card extractor then reads:

- `mirror.buffer.normal`
- `mirror.buffer.active`
- `mirror.buffer.alternate`
- `mirror.onWriteParsed`
- `mirror.rows`

This makes the server-side extractor very similar to the client-side extractor described earlier.

## Backend Mirror Requirements

The backend mirror must stay dimensionally close to the browser terminal:

- When the client sends resize events, resize both the PTY and the backend headless terminal.
- If several clients watch the same console at different sizes, choose a canonical backend size. A practical default is the last active client size, with a fallback such as `120x40`.
- Card extraction should tolerate wrap differences because browser width and backend width may still diverge.

The WebSocket protocol should grow a resize message if it is not already wired end-to-end:

```ts
{ type: "resize", consoleId, cols, rows }
```

Server handling should apply:

```ts
session.resize(cols, rows);
mirror.resize(cols, rows);
```

## Backend Persistent And Temporary Cards

With a headless mirror, the server can own both `persistentCards` and `temporaryCards`.

Persistent scan:

```ts
const buffer = mirror.buffer.normal;
const start = lastScannedFinalY;
const end = buffer.baseY;
```

Temporary scan:

```ts
if (mirror.buffer.active === mirror.buffer.alternate) {
  temporaryCards = [];
  return;
}

const buffer = mirror.buffer.normal;
const start = buffer.baseY;
const end = buffer.baseY + mirror.rows;
```

The same deduplication rules apply:

- Add only new hashes to `persistentCards`.
- Rebuild `temporaryCards` on every scan.
- Hide temporary cards whose hash already exists in persistent cards.

## Revised Recommended Architecture

For yconhost, the backend headless approach is probably the better long-term design:

```text
node-pty session
  -> log store, raw bytes
  -> browser xterm, UI
  -> @xterm/headless mirror, backend rendered buffer
       -> finalized scrollback extraction
       -> visible normal screen extraction
       -> persistent/temporary cards API
```

The browser should render cards received from the server, not derive its own canonical cards.

Suggested API shape:

```http
GET /api/consoles/:id/cards
```

Response:

```ts
type ConsoleCardsResponse = {
  persistentCards: ExtractedCard[];
  temporaryCards: ExtractedCard[];
};
```

The existing console snapshot could also include these arrays, but a separate endpoint is cleaner because cards may refresh more often than console metadata.

## Revised Implementation Plan

1. Add `@xterm/headless`.
2. Add a `HeadlessTerminalMirror` wrapper around `@xterm/headless`.
3. Store one mirror per managed console.
4. On every PTY output chunk, write the chunk to both log storage and the mirror before broadcasting.
5. Use `mirror.onWriteParsed` to schedule a throttled scan.
6. Implement `extractCardsFromBufferRange(...)`.
7. Store `persistentCards`, `temporaryCards`, `lastScannedFinalY`, and card hashes per console.
8. Add resize handling from browser to server and apply it to PTY plus mirror.
9. Add `GET /api/consoles/:id/cards`.
10. Render a collapsible cards panel outside xterm.
11. Keep the existing raw parser only as a temporary compatibility path, or replace unread counters with counts derived from cards.

## Backend Variant Tradeoffs

Advantages:

- Cards exist even if no browser is open.
- Server-side unread counters can be derived from the same card source.
- No custom ANSI parser.
- Extraction works on rendered terminal state, not raw stdout.

Costs:

- More memory per console because each console has an additional terminal buffer.
- Resize semantics become important.
- Backend and frontend xterm dimensions can diverge.
- Need to keep `@xterm/headless` and `@xterm/xterm` reasonably aligned.
- Click-to-scroll still requires client-side mapping or backend-provided approximate line references.

## Click-To-Scroll With Backend Cards

Backend cards can store approximate buffer positions:

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
  bufferY?: number;
};
```

However, browser xterm may have a different width and therefore different wrapping/line positions. Treat backend `bufferY` as a hint, not a perfect coordinate.

Reliable highlighting would still need a client-side marker/decorations layer for lines that are observed by the browser while open. For old cards created only on the backend, jump-to-card can be approximate unless the frontend restores the same serialized terminal state.

If exact restoration becomes necessary, investigate `@xterm/addon-serialize` compatibility with the headless backend mirror.
