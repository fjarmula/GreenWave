# Documentation copy and reading layout

## Scope

Revise the documentation on current main using idiomatic Polish, preserve GreenWave as a proper noun and describe simulated outcomes without promises of real-world savings. Remove the Running it / Uruchomienie section in both languages, rename the page Documentation / Dokumentacja and use an SVG icon for the demo link.

The desktop layout uses a section rail and a single reading column. Phones keep horizontal tabs, stacked technology rows and labelled source details rather than a wide data table. Section links and keyboard navigation remain available. Switching from a scrolled section restores the next heading to view.

## Verification and handoff

Regression tests cover removed installation content, the heading and SVG icon, vertical keyboard navigation, mobile source labels and legacy `#run` fallback. The browser check in `frontend/scripts/smoke/docs-review.js` covers PL/ENG at desktop and phone widths, overflow, keyboard activation, diagrams and section changes after scrolling.

Commit locally on `codex/refine-documentation`. Do not push or create a PR until the user accepts the result.

## Results

Lint, typecheck, formatting, all 1,246 tests and the production build passed. Chromium passed 50 section/language/viewport cases, keyboard navigation and switching sections after a long scroll. Light and dark screenshots were inspected. The copy reviewer found no language or factual regression.

WebKit completed the layout checks and screenshots, but its strict runner reported access-control failures on shared navigation RSC prefetch requests for `/driver` and `/compare`, on both localhost and 127.0.0.1. That run is not recorded as a clean pass. No shared routing behavior was changed for this documentation task.
