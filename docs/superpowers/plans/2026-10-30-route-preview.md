# Route Preview and Sidebar Implementation Plan

> Execute inline with executing-plans, TDD and verification-before-completion. User explicitly requested direct implementation; no implementation approval checkpoint. Later instructions authorize a separate branch, focused commits and a PR.

**Goal:** Show the actual planned route during setup and independently scroll live monitoring panels.
**Architecture:** Extend ranking with already calculated geometry; render via RouteLayer. Existing dispatch state owns freshness; simulation state continues to own playback. Bound live inspector panels with grid/flex.
**Tech Stack:** Existing FastAPI/Pydantic, React, MapLibre and CSS.
**Spec:** docs/superpowers/specs/2026-10-30-route-preview-design.md

## Constraints
No routing algorithm, timing, signal or dependency changes. Generate contracts.
Preserve bilingual copy, setup controls, phone sheets and endpoint markers.

## Review Focus
Stale ranking during density debounce; empty and on-site candidates; manually selected station;
preview during STARTING; small viewport controls and independent scrolling.

## Tasks
- [x] Add failing API tests proving rank geometry equals simulation geometry, with no sessions.
  Retain geometry in RankedStation, expose optional canonical route_geometry, regenerate contracts,
  validate it at frontend boundary, and provide mock geometry using shared mock route construction.
- [x] Add failing preview-selection tests for loading, errors, on-site, modes and manual selection.
  Render ready ranking geometry as a dashed neutral RouteLayer in setup, with localized status;
  fit preview geometry without enabling vehicle following or simulation effects. Reuse in comparison setup.
  Exercise existing stale-response dispatch regressions with geometry-bearing results.
- [x] Bound the desktop live inspector, controls and both panel bodies; preserve phone sheet behavior.
  Verify overflow, independent scrolling and visible headers in browser at desktop/laptop/mobile sizes.
- [x] Run frontend lint/typecheck/format/tests/build, backend checks and relevant browser smoke;
  review diff and report changed files, evidence and limits. Proposed commit: feat: preview dispatch routes and bound monitoring panels.

## Verification
Frontend lint, typecheck, format check, all 1,306 tests and production build passed.
Backend Ruff, formatting, mypy and all 1,557 tests passed.
Playwright preview updates passed in both modes. Independent scrolling passed at
1440×900, 1280×720, 1024×600 and 390×844. Existing mobile layout smoke passed,
including landscape. Existing localization smoke failed on its unchanged homepage
heading selector before reaching preview; targeted PL/EN preview checks passed.
Review found no blocking issues. Work is split into backend geometry, frontend preview and sidebar scrolling commits on `codex/route-preview-sidebar-scrolling`.

Production-build smoke rerun passed for route updates in both modes, preview-to-playback
transition, independent panel scrolling, mobile landscape and targeted PL/EN preview copy.
Browser console recorded no errors or warnings. Full quality checks passed again before committing.
