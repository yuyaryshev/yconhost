# Desktop Installation

Open http://127.0.0.1:4011/ in Chrome and choose More > Cast, save, and share > Install page as app. The manifest supplies the yconsole name, standalone window mode and application icons. The service continues to run through PM2 independently of the app window.

The icon preserves the dark terminal tile and green > prompt, with a light lowercase y above the underline. The editable source is public/favicon.svg. Run pnpm generate:icons to render the PNG sizes and multi-resolution ICO using installed Chrome or Edge; CHROME_PATH can select another Chromium executable. Generated assets are committed so normal builds do not require a browser.

Installation icons are explicit PNGs at 192 and 512 pixels, plus a separate full-background maskable icon. Browser tabs use SVG/ICO; Apple touch icons use a 180-pixel PNG. Icon URLs are versioned so the revised artwork is distinguishable from cached assets. The application manifest has a stable root id and start URL.

A previously installed manual app may retain its generated letter icon. Reinstall it from the updated page for immediate replacement. Do not select removal of browsing/site data when uninstalling if local UI preferences should be retained. Browser-managed icon updates can be delayed or require confirmation. Installing or removing the desktop shortcut does not delete server-side console definitions or stop their processes.

No service worker caches terminal pages or API traffic: the local server must be available for the application to work.
