# UI Layering

The application shell is an isolated stacking context. Terminal canvases, menus
and the stopped-console command surface must stay inside it. Ariakit renders
modal dialogs and their backdrops in a portal outside the shell, above the
application content. Do not fix content escaping above a dialog by continually
increasing the dialog's z-index.

The stopped-console command surface is normal-flow content, not a global modal
backdrop. Its previous `z-index: 2` let its tinted background paint over Preferences
and other auto-layered dialogs. The unnecessary z-index was removed, and shell
isolation also contains other terminal/menu layers.

Regression checks: select an idle console with a colored background; open
Preferences, Open folder, Create console, project Add console, and console Settings.
Their surfaces and controls must remain visible and usable above the terminal.
Backdrop clicks must not reach the terminal. After dismissing the dialog, command
text must remain selectable. Check both themes, narrow viewports, and a running
terminal as well as an idle slot. These checks must not start or stop user commands.

Use screenshots as well as hit testing: Ariakit makes background content inert,
so `elementFromPoint` can report unobstructed dialog controls even when an escaped
background layer still paints over them.

2026-10-24: captured the actual desktop and reproduced Preferences being covered
by the blue idle-console background for `odbp_requirements`. After the fix, verified
Preferences, Open folder, Create console, Add console and Console settings in Chrome;
also checked the light theme, a 390x844 viewport, and the existing running terminal.
Dialog z-index remained `auto`; the shell became isolated and the command surface
lost its positive z-index. No settings were saved or user consoles restarted.
The production build and all 38 tests passed. Updated frontend assets are served
immediately; reload the browser/PWA to use them, without restarting the backend.
