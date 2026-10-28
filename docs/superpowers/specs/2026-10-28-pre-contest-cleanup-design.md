# Pre-contest cleanup: design

- Date: 2026-10-28
- Status: Approved (Piotr, 2026-10-28)
- Scope: whole repo (backend, frontend, ETL, deploy, docs). Submission packaging is out of scope.

## Intent

Make the repo ready to send to the Kraków Open Data App contest (entries due 2026-11-05): fix
the bugs a six-area read-only audit found, remove dead and duplicated code, and bring every doc
in line with the code. Judges will read the repo, so the docs must say what the app does.

## Rules (human)

- Small, behaviour-preserving cleanups are the builder's call.
- Bigger restructurings, contract changes and bug fixes need human approval; the items below
  are approved.
- Never break the live demo: every change runs the full backend and frontend checks; changes to
  simulation or dispatch also get a browser check.

## Approved changes

### Bugs

1. README and `backend/README.md` ETL steps omit `places` and `quality`; a backend built from
   them does not start.
2. No error boundary on simulation pages: a WebGL failure blanks the page.
3. Start button reads "Computing route…" while a comparison owns the simulation.
4. ITS `expected_arrival_utc` adds simulated seconds to wall-clock time (wrong at playback > 1x);
   the mock does the same.
5. The backend simulation adapter pushes into the ITS request array the reducer state holds.
6. The default scenario time is formatted in the browser's time zone; the backend reads it as
   Europe/Warsaw.
7. The station list loads once; a backend started after the page leaves it empty.
8. An intersection that never had priority enters RECOVERY on passage.
9. A PRM base that does not snap is dropped silently with its teams.
10. Deploy rollback shares one processed-data directory: document as a known limitation only.

### Logic flaws

- L1 Ranking follows the request's `time_mode` for every vehicle type: on-site vs drive
  comparison and final order use `total_seconds_for(time_mode)`; team ranking runs the full
  estimate for every eligible base (no shortlist cut, at most 8 bases today).
- L2 Dispatch state starts at the settings' density, and a density change marks the ranking
  stale immediately (no "ready" ranking for the old density).
- L3 Curated inputs (`data/curated/prm_bases.json`, `data/overrides/roundabouts.json`) are hashed
  into the ETL report and checked by the `quality` step and the real-data smoke test.

### Decisions

- D1 Merge the desktop dispatch panel and the phone setup details into one shared component
  (last code milestone, own commit).
- D2 Contract: drop `StationSourceKind` `ambulance_base` and `hospital_ed`, drop
  `DispatchRankResponse.station_at_incident`; add `AreaRuleOutcome.margin_seconds`; the frontend
  shows the backend's off-network message instead of a hard-coded "800 m". `schema_version` stays
  `"1.0"` (pre-release PoC, single client in this repo).
- D3 = L1.
- D4 Remove unused frontend dependencies (`@base-ui/react`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `@tailwindcss/turbopack`); keep `shadcn` only if its stylesheet import is
  used.
- D5 Docs: README becomes the front door (pitch, features, quick start, data credits, licence);
  ADR index with statuses (human flips Proposed → Accepted), duplicate 0008 explained, not
  renumbered; completed superpowers plans/specs move to `archive/` with a one-page
  `docs/superpowers/HISTORY.md`; one-off verification logs move to `docs/engineering/history/`.

### Builder's cleanups (behaviour-preserving)

Dead code (superseded TTI state machine functions, unused phases helpers, the dead start-button
path, dead CSS including `data-focus` rules, dead KPI outcome chip, unneeded `export`s),
duplicated helpers (hashing, stale-input checks, initial engine state, local-time formatting,
team literals, dataclass→schema copies), and low-severity fixes the audit listed (a11y
attributes, duplicate React keys, aborted requests logged as failures, response normalisation,
enum tables typed against the contract, ETL KeyError → `StaleArtifactError`).

## Non-goals

- No new features, no change to simulation results except via L1 and bug 8.
- No versioned processed-data directories in deploy, no overnight shifts, no dashboard split, no
  runtime-image slimming, no generated validators.
- No change to submission packaging or repo presentation beyond the docs above.

## Anti-goals

- A refactor that changes a pinned snapshot without a reason in the commit.
- Docs that claim behaviour the code does not have.
- Flipping ADR statuses without the human.
