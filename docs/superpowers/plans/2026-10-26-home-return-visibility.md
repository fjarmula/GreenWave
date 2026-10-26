# Home Return Visibility Implementation Plan

**Goal:** Reliable home text after client navigation, with no home workspace menu.
**Spec:** `docs/superpowers/specs/2026-10-26-home-return-visibility-design.md`
**Scope:** Existing branch, HomeMenu/CSS and relevant tests; no dependencies/contracts/backend changes.

- [x] Reproduce repeated Link return and browser-back navigation in Chromium and WebKit; inspect computed styles and screenshots.
- [x] Add a failing home navigation markup regression; remove only the home menu.
- [x] Correct the foreground paint/animation behavior based on browser evidence and rerun client navigation checks in light/dark and phone/desktop layouts.
- [x] Run frontend quality checks, review diff and save a local fix commit.

## Investigation

Chromium: six client navigation/back cycles retain visible headline (opacity 1, no active animation after settling). WebKit investigation follows.


## Findings and verification

The persistent screenshot failure did not reproduce in short native navigation runs in either
engine. A controlled paused/restored entrance animation did reproduce invisible headline text
(opacity 0). Removed all home entrance animations so essential content never starts hidden;
added an explicit positioned foreground stacking layer above the live map. This also covers
the brand, which was not individually animated. No reload or routing workaround was added.

Removed only the duplicate home workspace menu; all mode cards and tool links remain.
Regression markup test observed RED then GREEN. Reusable browser regression:
`frontend/scripts/smoke/home-return.js` (playwright-cli run-code; base URL 127.0.0.1:3100).
It checks content with animations paused at their initial frame and repeated client navigation
and browser-back returns, at 1440px and 390px, light/dark, through Green Wave/Driver/Comparison.
Both Chromium and WebKit pass all 12 cases each. Full frontend lint/typecheck/format-check,
104 files / 1,036 tests, and production build pass. The original intermittent browser-specific
paint failure cannot be claimed independently reproduced; these changes remove its suspected
animation/layering prerequisites.
