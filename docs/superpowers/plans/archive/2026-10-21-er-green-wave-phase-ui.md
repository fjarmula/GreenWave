# ER Green Wave Phase UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render legible, accurate simulated phase detail at high zoom and make mock transport match corrected disabled-mode semantics.

**Architecture:** Keep MapLibre lifecycle in `SignalMarkers` and pure layout/lifecycle helpers. Consume only validated backend phase data, retain a labelled intersection fallback for unavailable geometry, and update mock phase/motion/cascade behavior to the completed backend contract.

**Tech Stack:** Next.js, React, TypeScript, MapLibre GL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md`

## Global Constraints

- Execute the phase-domain plan first and use generated types if it changed the contract.
- Do not calculate signal colours in MapLibre components.
- Do not fabricate signal positions; explicitly render phase-detail unavailability instead.
- Colour is supplementary to concise text and ARIA labels.
- Add no dependency or lockfile change.

## Review Focus

- High zoom with zero phases preserves a labelled intersection fallback.
- Nearby signals at the same or almost the same coordinate do not overlap unreadably.
- A phase update changes marker colour, text, title, and ARIA label.
- A pedestrian-only phase never shows `SIM CAR`.
- Disabled mock runs have rolling, not zero-speed, red/yellow crossings and empty cascade targets.

---

### Task 1: Fix mock contract parity

**Files:**
- Modify: `frontend/src/lib/mock-session.ts`, `frontend/src/lib/mock-simulation-config.ts`
- Test: `frontend/src/lib/mock-session.test.ts`, `frontend/src/lib/mock-simulation-adapter.golden.test.ts`

**Interfaces:**
- `createMockSession(request)` makes `cascade_targets` empty when `green_wave_mode` is `DISABLED`.
- Mock route data includes fixed synthetic ordinary/ambulance speed and crossing-distance inputs; tick speed/progress uses the backend's red/yellow rolling-penalty formula at contract level.

- [ ] **Step 1: Write failing parity tests**

Assert disabled requests with cascade enabled have no route cascade targets, no dispatch, no corridor state, and positive speed during a red/yellow crossing. Assert a green crossing has no penalty.

- [ ] **Step 2: Run focused mock tests to verify failure**

Run: `cd frontend && npm test -- lib/mock-session.test.ts lib/mock-simulation-adapter.golden.test.ts`

Expected: FAIL because mock progress uses stationary clearance and derives disabled cascade targets from the legacy toggle.

- [ ] **Step 3: Implement mock rolling parity**

Use an explicitly duplicated, documented two-group mock programme (frontend cannot import backend Python). Add synthetic stop lines, ordinary/ambulance speeds, and crossing distance. At red/yellow entry, distribute the mock cautious time over its synthetic crossing distance; at green, retain ambulance speed. Update `frontend/src/lib/__snapshots__/mock-stream.json`.

- [ ] **Step 4: Run focused mock tests to verify pass**

Run: `cd frontend && npm test -- lib/mock-session.test.ts lib/mock-simulation-adapter.golden.test.ts`

Expected: PASS.

### Task 2: Add phase fallback and collision-safe layout

**Files:**
- Modify: `frontend/src/lib/signal-phase-layer.ts`, `frontend/src/components/map/SignalMarkers.tsx`, `frontend/src/components/map/MapContainer.tsx`
- Test: `frontend/src/lib/signal-phase-layer.test.ts`

**Interfaces:**
- `layoutPhaseMarkers(phases: SignalPhaseIndicator[]) -> Map<string, PhaseMarkerLayout>` returns a stable identity-keyed item with phase and pixel offset; identity is `(intersection_id, signal_key, kind)`.
- `SignalMarkers` retains a coarse state marker at detailed zoom for intersection ids with no received phase.

- [ ] **Step 1: Write failing UI tests**

Use pure layer/layout doubles to assert high-zoom fallback for a phase-less intersection, one pedestrian-only marker, deterministic distinct offsets for co-located phase markers, and updates to colour/text/title/ARIA values. Do not add jsdom or a browser dependency.

- [ ] **Step 2: Run focused map tests to verify failure**

Run: `cd frontend && npm test -- lib/signal-phase-layer.test.ts`

Expected: FAIL because the component has no fallback and uses fixed two-pixel pair offsets.

- [ ] **Step 3: Implement grouped layout and fallback**

Pass layout items to the marker factory and `update`, recalculating every item's offset whenever its group changes. At detailed zoom suppress dots by intersection id only when that id has phase data, not through global `showDots`. Add an accessible simulated-detail-unavailable label to retained fallbacks.

- [ ] **Step 4: Run focused map tests to verify pass**

Run: `cd frontend && npm test -- lib/signal-phase-layer.test.ts`

Expected: PASS.

### Task 3: Validate and verify the UI increment

**Files:**
- Modify: `frontend/src/lib/transport/validate.ts`, `frontend/src/lib/transport/validate.test.ts` only if the phase contract changed

- [ ] **Step 1: Add boundary validation only for new consumed fields**

Reject duplicate `(intersection_id, signal_key, kind)` identities and any new public field the UI dereferences; preserve narrow runtime guards rather than duplicating Pydantic validation.

- [ ] **Step 2: Run frontend checks**

Run: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/mock-session.ts frontend/src/lib/mock-simulation-config.ts frontend/src/lib/mock-session.test.ts frontend/src/lib/mock-simulation-adapter.golden.test.ts frontend/src/lib/__snapshots__/mock-stream.json frontend/src/lib/signal-phase-layer.ts frontend/src/lib/signal-phase-layer.test.ts frontend/src/components/map/SignalMarkers.tsx frontend/src/components/map/MapContainer.tsx frontend/src/lib/transport/validate.ts frontend/src/lib/transport/validate.test.ts
git commit -m "fix: render simulated signal phases clearly"
```
