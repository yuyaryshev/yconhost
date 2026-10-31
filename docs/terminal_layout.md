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
