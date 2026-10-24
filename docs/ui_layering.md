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
