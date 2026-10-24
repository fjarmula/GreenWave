# P5 Station Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Also: test-driven-development, emil-design-eng (row styling), mobile-native (touch targets), playwright-cli, verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dispatcher picks any of the ranked stations (fastest pre-selected), and every run, comparison, estimate and map marker uses the picked one.

**Architecture:** The incident-dispatch store (`createIncidentDispatch`) gains `selectedStationId` and `selectStation`. A pure `selectedCandidate(state)` resolves it, falling back to the fastest. Every reader of `ranking.candidates[0]` switches to that helper. `StationRanking` becomes a radio fieldset.

**Tech Stack:** React 19, Next.js (read `frontend/node_modules/next/dist/docs/` before touching Next APIs), Tailwind v4, Vitest (node environment, `renderToStaticMarkup`, no DOM events), `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-24-dispatch-access-and-map-framing-design.md` (section A).

## Global Constraints

- Frontend only. No backend, contract, or generated-type change.
- No new dependencies.
- Copy (exact): legend `Dispatch from`; badge `Fastest`; delta `+{n} s` (road-time ranking, `n` = rounded seconds difference) or `+{x.x} km` (mock, one decimal); the existing `Approximate (mock)` chip stays.
- Rows ≥ 44 px on `(pointer: coarse)`.
- Browser artefacts only under `.tmp/playwright/p5/`.
- Checks: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. A re-rank arrives while a non-fastest station is selected (incident moved, vehicle type changed): the selection resets to the fastest and the old ID never leaks into the new start request. Task 1 test `resets selection on every re-rank`.
2. `selectStation` is called with an ID that is not a current candidate (stale click during loading): the state is unchanged. Task 1 test `ignores unknown station ids`.
3. A ranking with one candidate: a single pre-checked radio, no delta, no runners-up on the map. Task 3 test `single candidate renders one checked radio`.
4. A comparison started after picking station #2 runs both members from #2. Task 2 test in `start-request.test.ts` plus the Task 4 browser step.
5. A run is live and the user changes the selection in setup (driver sheet or Green Wave panel): the live map keeps the run's captured labels (`runLabels`) until the next start. Task 4 browser step.

---

### Task 1: Selection in the dispatch store

**Files:**
- Modify: `frontend/src/lib/useIncidentDispatch.ts`
- Test: `frontend/src/lib/useIncidentDispatch.test.ts`

**Interfaces:**
- Produces:
  - `IncidentDispatchState.selectedStationId: string | null` (initially `null`)
  - `selectStation(stationId: string): void` on the store and on `IncidentDispatch`
  - `export function selectedCandidate(state: Pick<IncidentDispatchState, "ranking" | "selectedStationId">): RankedCandidate | null`: the candidate with that ID, else `ranking.candidates[0]`, else `null`.

- [ ] **Step 1: Write the failing tests** (in the existing `describe("createIncidentDispatch")`, reusing `deferredAdapter`, `incident`, and a `ranking` variant with three candidates `A`, `B`, `C`):
  - `selects the fastest by default`: after the rank resolves, `selectedCandidate(getState())?.station.station_id === "A"` and `selectedStationId === null`.
  - `selects another candidate`: `selectStation("B")` → `selectedStationId === "B"` and `selectedCandidate(...)` is `B`.
  - `ignores unknown station ids`: `selectStation("Z")` leaves the state object identical (`toBe` the previous `getState()`) and notifies no listener.
  - `resets selection on every re-rank`: select `B`, then `setIncident(incident(50.1))` → `selectedStationId === null` while loading and after the new rank resolves; the same for `setVehicleType("FIRE_TRUCK")`.
  - `falls back to the fastest`: `selectedCandidate({ ranking, selectedStationId: "gone" })` is `A`; with `ranking: null` it is `null`.
- [ ] **Step 2: Run them, expect failures**
  Run: `cd frontend && npx vitest run src/lib/useIncidentDispatch.test.ts`. Expected: FAIL (`selectStation is not a function` / `selectedCandidate` not exported).
- [ ] **Step 3: Implement.** `rank()` puts `selectedStationId: null` into both its `update` patches. `selectStation` returns early unless `state.ranking?.candidates.some(c => c.station.station_id === id)`. `useIncidentDispatch` returns `selectStation` too.
- [ ] **Step 4: Run the tests, expect PASS.** Then `npm run typecheck`. Every object typed `IncidentDispatch` in tests and fixtures (`grep -rn "setIncident:" src`) gets `selectedStationId: null, selectStation: () => {}`.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/useIncidentDispatch.ts frontend/src/lib/useIncidentDispatch.test.ts <updated fixtures>
  git commit -m "feat: hold the dispatcher's station choice in the dispatch store"
  ```

### Task 2: Every consumer uses the selected candidate

**Files:**
- Modify: `frontend/src/components/dashboard.tsx:90,134`, `frontend/src/components/comparison/ComparisonWorkspace.tsx:35,109-111`, `frontend/src/components/hud/DispatchForm.tsx:67,201`, `frontend/src/components/driver/DriverSetupSheet.tsx:21,167`
- Create: `frontend/src/lib/station-choice.ts`, `frontend/src/lib/station-choice.test.ts`

**Interfaces:**
- Consumes: `selectedCandidate` (Task 1).
- Produces: `export function runnerUpIds(ranking: DispatchRankResponse | null, selectedId: string | null): string[]`: candidate IDs minus the selected one (the resolved one, so `null` excludes the fastest), in ranking order.

- [ ] **Step 1: Write the failing tests** in `station-choice.test.ts`:
  - `runnerUpIds(ranking, null)` → `["B", "C"]`; `runnerUpIds(ranking, "B")` → `["A", "C"]`; `runnerUpIds(ranking, "gone")` → `["B", "C"]`; `runnerUpIds(null, null)` → `[]`.
  - Start request: `buildStartRequest(selectedCandidate({ ranking, selectedStationId: "B" })!.station, …).origin` equals B's position.
- [ ] **Step 2: Run, expect FAIL** (`runnerUpIds` not exported). Run: `npx vitest run src/lib/station-choice.test.ts`.
- [ ] **Step 3: Implement** `runnerUpIds`. Replace each `candidates[0]` read listed above with `selectedCandidate(dispatch)`, and each runners-up computation with `runnerUpIds(dispatch.ranking, dispatch.selectedStationId)`.
- [ ] **Step 4: Verify.** `npx vitest run` passes. `grep -rn "candidates\[0\]" src --include=*.tsx --include=*.ts | grep -v test` prints only `src/lib/useIncidentDispatch.ts` and `src/lib/station-choice.ts`.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/station-choice.ts frontend/src/lib/station-choice.test.ts frontend/src/components/dashboard.tsx frontend/src/components/comparison/ComparisonWorkspace.tsx frontend/src/components/hud/DispatchForm.tsx frontend/src/components/driver/DriverSetupSheet.tsx
  git commit -m "feat: start runs from the selected station"
  ```

### Task 3: Selectable `StationRanking`

**Files:**
- Modify: `frontend/src/components/hud/dispatch/StationRanking.tsx`, call sites `DispatchForm.tsx:95` and `DriverSetupSheet.tsx:127`
- Modify (if needed): `frontend/src/app/globals.css`, a `.station-choice` block next to the other HUD rules
- Test: `frontend/src/components/hud/dispatch/StationRanking.test.tsx`

**Interfaces:**
- Consumes: Task 1 `selectedCandidate`, `selectStation`.
- Produces: `StationRanking` props gain `selectedStationId: string | null` and `onSelect: (stationId: string) => void`.

- [ ] **Step 1: Write the failing tests** (static markup, existing `RANKING` fixture):
  - `renders a radio per candidate`: markup has `<fieldset`, `<legend` containing `Dispatch from`, and 3 `type="radio"` inputs sharing one `name`.
  - `checks the fastest by default`: with `selectedStationId: null`, only the `STN-A-0006` input is `checked`. With `"STN-A-0007"`, only that one.
  - `shows deltas against the fastest`: contains `+41 s` (289 − 248.4 rounded) and `+101 s`; with `roadTimeRanking: false`, contains `+0.6 km` and `+1.8 km`.
  - `badges the fastest`: `Fastest` appears exactly once.
  - `single candidate renders one checked radio`: one-candidate ranking → one checked radio, no `+`.
  - Existing loading / error / empty / `station_at_incident` tests stay green.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/components/hud/dispatch/StationRanking.test.tsx`.
- [ ] **Step 3: Implement.** Each row is a `<label>` wrapping a visually hidden native `<input type="radio">` (name from `useId()`), with `onChange={() => onSelect(id)}`. The checked row gets the current winner styling (`border-go/30 bg-go/8`); the others are neutral with a hover tint. Focus-visible ring on the label via `:has(:focus-visible)`. Keep the time column; add the delta beneath it in `text-2xs text-muted-foreground`. Call sites pass `dispatch.selectedStationId` and `dispatch.selectStation`.
- [ ] **Step 4: Run tests, expect PASS;** run `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/components/hud/dispatch/StationRanking.tsx frontend/src/components/hud/dispatch/StationRanking.test.tsx frontend/src/components/hud/DispatchForm.tsx frontend/src/components/driver/DriverSetupSheet.tsx frontend/src/app/globals.css
  git commit -m "feat: let the dispatcher choose between the ranked stations"
  ```

### Task 4: Browser verification

**Files:** none (artefacts in `.tmp/playwright/p5/`).

- [ ] **Step 1:** Run the full frontend checks (Global Constraints). Expected: all pass.
- [ ] **Step 2:** With the backend running (`cd backend && uv run uvicorn greenwave.main:app`) and `npm run dev`, use the `playwright-cli` skill at 1440×900:
  - Green Wave: pin an incident and choose the second station. The chosen marker moves to it. Initialize, and the route starts at that station.
  - Change the selection while the run is live. The live map's origin label does not change.
  - Comparison: choose the third station and start. Both panes start there.
  - Driver at 390×844: the radio rows are reachable in the setup sheet and the chosen station is used.
  Save screenshots as `.tmp/playwright/p5/<step>.png` and look at each one.
- [ ] **Step 3:** Report the milestone: changed files, check output, screenshots reviewed, and the proposed commit message (if not committed per task).
