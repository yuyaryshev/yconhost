# Terminal Width

Keep the terminal host's horizontal gutters as margins, not padding. FitAddon
calculates columns from the host's computed width and subtracts padding on xterm
itself, but not padding on its parent. With border-box sizing, the former 10px
host padding on each side made the rendered screen wider than the available area.

2026-10-31: captured all three physical displays and inspected the installed
yconhost app on the primary display. Reproduced a 9px horizontal overflow in
Chrome. Replaced only horizontal host padding with equivalent 10px margins;
text position, 320px sidebar, terminal height and all overflow rules are unchanged.
At the app's 1920x1014 content viewport, verified scrollWidth equals clientWidth,
including with Default expanded and the outer vertical scrollbar present.
Production build passed; Chrome reported no warnings/errors. The viewed session's
PID and native dimensions remained unchanged (test-tab input/resize forwarding
was blocked). No service restart is needed; reload the installed app to load the
rebuilt static stylesheet. Wider native screens/content can still scroll normally.

## Shared Header and Scrolling Body

The app uses two viewport rows: a fixed common header and one scrollable body.
The header contains the app controls, Cards filters, console name/path and console
actions, in that order. TerminalPane portals its controls into the header so that
the same component continues to own the cards/terminal state and actions.

The body contains the project sidebar and console contents in a two-column grid.
Both columns move with the same scroll offset; neither has a separate vertical
scroll container. Cards remain above the terminal. Project expansion and large
card histories increase this shared body's content height, not the document's.
The app shell is viewport-constrained, so there is no outer page scrollbar.

On narrow screens, the header controls wrap and the body columns stack, retaining
the same single scroll container. Modal dialogs remain outside the shell's
stacking context. Terminal wheel handling, initial console selection and the
Scroll to terminal button all target the shared body; stopped consoles use their
command surface as the terminal destination too.

### Verification, 2026-10-31

- Captured the physical displays and followed the common-header prototype shown
  in the image editor. Chrome checked 1920x1014, 1280x800 and 390x844 viewports,
  both themes and the Preferences modal above the new header/body.
- With 500 retained cards, only console-scroll was vertically scrollable; the
  document's scrollHeight equalled the viewport height and horizontal overflow
  was zero. Scrolling 200px moved both columns by exactly 200px while header top
  remained zero. Filtering/collapsing cards and jumping to the terminal worked.
- With all 82 codexes slots expanded and a running terminal, the shared body grew
  to fit the sidebar. A 240px wheel event over the terminal moved both columns
  240px, with no outer-page or nested sidebar scrollbar.
- All 52 tests and the production build passed. Chrome reported no warnings or
  errors. Test-tab input/resize forwarding was disabled; no commands were sent,
  settings saved, or service/console processes restarted. Reload the browser/PWA
  to activate the rebuilt UI.

## Sidebar Density and List Expansion

Touch mode is a browser-wide preference, enabled by default and stored under
yconhost-touch-mode in localStorage. Its checkbox sits immediately before Gather
errors; it also remains available for read-only PM2 views. It is not a console or
server setting and never changes process state.

Disabling Touch mode halves project headers from 42px to 21px (and halves the
inter-project gap). Console rows become 24px high, matching the search field;
sidebar action buttons shrink to fit. Enabling it restores the existing roomy
spacing. Console output, cards, dialogs and toolbar sizing are unchanged.

Large-project lists have a reversible end-of-list button: Show all switches to
Свернуть компактно while expanded. Collapsing clears the search and restores the
nine most recent launches; project collapse still resets expansion as before.
