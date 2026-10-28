# Docked start and unified camera control

The start action sits at the bottom-right of each setup workspace, visually detached from Incident dispatch. Settings panels and phone sheets reserve its measured height, including errors and on-site results, so nothing covers the action. It remains accessible in Focus and with Details hidden.

A single workspace camera action switches between Follow vehicle (overview or manually suspended) and Show route (following). It shares one aligned row with Dispatch settings. Comparison operates its maps together. Stale and finished maps retain Show route without offering to follow stale positions. Remove the redundant follow switch inside settings.

Plan: add failing camera/registry tests; implement the shared control row and measured bottom dock; verify desktop, phone, landscape, Focus, completion and comparison; run frontend checks and a fresh review; publish a new PR. No dependencies, contracts or simulation logic change. The new PR supersedes closed, unmerged PR #50 and includes its prerequisite changes.

Follow and Show route reuse the existing 600 ms station/incident camera timing. Show route uses an eased pan/zoom rather than a flight arc. Reduced motion remains immediate, and gestures and rapid toggles interrupt from the current view.

## Verification — 2026-10-27

- Frontend lint, typecheck, formatting, 1057 tests and production build passed. Backend Ruff, formatting, mypy and 1309 tests passed for the prerequisite changes included in this replacement PR.
- Playwright CLI: 24 setup route/viewport combinations (1440, 1280, 768, 390, 320 and short landscape), action hit-testing and separation from panels; aligned toggles at desktop/390/320; Focus, rapid toggles, reduced motion, shared comparison control and route overview after stopping.
- Actual Follow/Show route transitions produced 37–38 monotonic zoom frames over approximately 600ms in each direction. Existing 600ms focus timing was shared rather than adding an independent timing convention.
- Fresh review found the phone sheet's new clipping wrapper isolated its measured clearance from sibling map controls. Browser reproduction failed before publishing the measurement on the workspace shell and passed afterward (73px minimized clearance; controls above the sheet). No deferred minors. Physical-device gesture feel remains a manual hardware check.
- Added a RED→GREEN regression for Show route winning over a wheel gesture completed by fitBounds, preserving one-click interruption behavior.
- PR #50 was closed without merging. This branch retains those prerequisite changes and supersedes it with the requested layout and camera refinements.
