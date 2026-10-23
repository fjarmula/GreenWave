# Visual audit scripts

Browser checks for the UI overhaul plan (`docs/superpowers/plans/2026-10-23-ui-overhaul.md`). Start the app on port 3000 (`npm run build && npm start` for timings; dev mode inflates them), then from the repo root:

```bash
playwright-cli open http://localhost:3000
playwright-cli --raw run-code --filename=frontend/scripts/visual-audit/routes.js        # frames → .tmp/playwright/visual/
playwright-cli --raw run-code --filename=frontend/scripts/visual-audit/theme-switch.js  # one toggle click per direction
```

`theme-switch.js` samples 90 frames after one toggle click per route and direction: `maxCssTransitions` (element transitions running at once), `crossFadeStartMs`/`crossFadeEndMs` (View Transition pseudo-element animations), `mapThemeMs` (map `data-map-theme` reaches the new theme), `longTasks` (ms) and `themeApplied`.

| Run (production build, headless Chromium)    | `/` element transitions | `/` longest task | map route element transitions | map route longest task   | map vs page                                              |
| -------------------------------------------- | ----------------------- | ---------------- | ----------------------------- | ------------------------ | -------------------------------------------------------- |
| Baseline (2026-10-23)                        | 886                     | 141–166 ms       | 2,393                         | 206–230 ms               | map dims at ~107 ms, restyles at ~381 ms                 |
| Phase 1: view-transition switch (2026-10-23) | 0                       | none             | 0                             | 270–370 ms (style parse) | new style ready 150–250 ms, before the cross-fade starts |

Headless Chromium renders WebGL in software, so map routes show ~60 ms frames with or without a theme switch.
