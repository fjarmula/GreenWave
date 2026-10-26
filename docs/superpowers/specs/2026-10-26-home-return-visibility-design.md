# Home return visibility correction

Keep the home headline, introduction and brand visible after client-side navigation away
and return, including browser back/forward. Remove the home workspace menu on desktop and
phone as requested; retain mode cards, tool links, theme controls and return-to-run link.
Preserve the corridor backdrop, responsive widths and shared simulation runtime.

Investigate animation state versus foreground/background paint order in Chromium and WebKit.
Prefer a CSS presentation fix over reloads, navigation interception or simulation-state changes.
Essential content should not depend on finishing an entrance animation to remain visible.
