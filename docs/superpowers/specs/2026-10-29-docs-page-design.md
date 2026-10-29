# Documentation page: design

- Date: 2026-10-29
- Status: Approved (Piotr, 2026-10-29)
- Scope: `frontend/` only. No backend, contract, or simulation change.

## Intent

The Kraków Open Data App contest (regulamin, zarządzenie nr 1194/2026) requires a submission
with a title, a description of up to 2 pages as a PDF, a working demo, launch instructions, and
technical documentation (§5.2). The technical documentation must cover technologies, data used,
architecture, and development potential. Entries are due 2026-11-05.

The demo gets a `/docs` page that holds all of this in one place, inside the app the jury
already opens. The PDF is written separately by the team, using the page as its source. Each
tab therefore maps to a part of the write-up.

## Goals

- A juror finds every §5.2 item from the standard workspace menu without leaving the demo.
- Content leans on the §4 scoring criteria: city impact (30%), data use (20%), innovation (15%),
  technical architecture (15%), business potential (10%), UX/UI (5% + 5%).
- Full PL/ENG parity: Polish by default, English through the existing switch.

## Non-goals

- Generating the PDF from the page.
- Rendering repository Markdown (README, ARCHITECTURE, ADRs) in the app.
- Developer-level detail: API payloads, ETL internals, ADR history.

## Anti-goals

- Text copied word for word from the repo docs. All copy is written fresh for a juror.
- Content that leaks internals beyond the write-up level. §8.3 lets the organizer show the demo
  publicly, while §8.2 keeps source code and technical docs confidential.
- Any claim that the system controls real signals. Simulation-only wording stays explicit.
- A new dependency (no Markdown or MDX library, no diagram library).

## Decided (human)

- Route `/docs`, listed in the standard workspace menu with the other modes.
- Layout B: tabs, one section at a time (chosen from three mockups).
- Six tabs in this order, with their content brief:
  1. **O projekcie / About.** The problem (emergency vehicles lose time at red lights), what
     ER-GreenWave does, who benefits (city, dispatchers, residents), and the three modes
     (Green Wave, standard traffic, comparison) plus the driver and diagnostics views in plain
     words. Team credits at the end.
  2. **Uruchomienie / Running it.** Live demo link, Docker Compose quick start, local run, and
     the mock transport that runs without the dataset. Commands as copyable blocks.
  3. **Technologie / Technologies.** Frontend, backend, data, and deployment stack, with one
     line on why each was chosen.
  4. **Dane / Data.** A table of each dataset: name, publisher, licence, data date, and use in
     the app. Covers OpenStreetMap (BBBike extract), MSIP *Ulice*, MSIP/ZDMK *Buspasy*,
     EMUiA *Punkty adresowe* (MSIP dataset 1492), and the Małopolska PRM plan. Then a section
     on how the sources are combined (snapping, reconciliation, cross-checks).
  5. **Architektura / Architecture.** A diagram of the offline ETL, processed dataset, FastAPI
     simulation, SSE stream, and Next.js dashboard. A plain explanation of the corridor logic
     (TTI, cascade within 250 m, simulated ITS feedback). The simulation-only safety note.
  6. **Rozwój / Future development.** Paths to a real deployment (real ITS integration with
     the road authority, live traffic, other emergency services, other cities) and business
     potential for the public and private sectors.
- The PDF is written separately. The page is its source.
- Bilingual, with full parity.

## Builder's calls (Claude, open to correction)

- Content lives in a typed module (`frontend/src/lib/docs/content.ts`) as
  `Record<Language, DocsSection[]>`, not in `polish.ts`. The dictionary is keyed by English
  UI strings and does not suit multi-paragraph copy. Shared UI labels (menu entry, page title)
  still go through `polish.ts`.
- Tab ids are language-neutral (`about`, `run`, `tech`, `data`, `architecture`, `roadmap`).
  The active tab lives in the URL hash (`/docs#data`), so the tab survives a language switch
  and is linkable. Back and forward follow the hash. An unknown hash opens `about`.
- Tabs follow the WAI-ARIA tabs pattern (`tablist`/`tab`/`tabpanel`, roving focus, arrow keys
  with wrap, Home/End, automatic activation). The look reuses the existing `hud-segmented` track.
  On phones the strip scrolls horizontally inside itself, never the page.
- Diagrams are inline SVG themed with CSS variables, with labels taken from content.
- Page chrome copies Diagnostics: `WorkspaceHeader variant="page"`, `ResponsiveNavigation`,
  `ThemeToggle`, and the same `content-page` main.
- On Home, Documentation joins the tool links (next to Diagnostics and Driver) with a
  `BookOpen` icon.
- Tests guard the content: PL/EN structural parity, identical commands in both languages, every
  dataset named, and no English sentence of 40 characters or more copied from `README.md`,
  `GreenWave_ARCHITECTURE.md`, `backend/README.md`, or `frontend/README.md`.

## Constraints

- Next.js 16.4 (read `frontend/node_modules/next/dist/docs/` before writing route code),
  React 19.3, Tailwind 4, lucide-react. No new dependency.
- Vitest runs in the `node` environment (static markup only). Interaction is covered by pure
  helpers plus a `playwright-cli` browser check.
- Facts in copy must match the code and `backend/data/raw/MANIFEST.json`, not memory.
- Light and dark themes. Phone width 360 px with no horizontal page scroll.

## Resolved

- Live demo URL for the Running tab: `https://green-wave.duckdns.org/` (the DuckDNS host of the
  Oracle deployment).
