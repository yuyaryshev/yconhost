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
