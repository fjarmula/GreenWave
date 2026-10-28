# M7 — Simulation Ids Outside Secure Contexts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (finding F5).

**Goal:** Start works when the dashboard is opened over plain HTTP on a LAN address (phone testing), where `crypto.randomUUID` is undefined.

**Architecture:** One helper, `createSimulationId(source = globalThis.crypto)` in `frontend/src/lib/simulation-id.ts`. It returns `source.randomUUID()` when that is a function. Otherwise it builds a 32-hex-character id from `source.getRandomValues(new Uint8Array(16))`, which is available in insecure contexts. Both forms match the contract pattern `^[A-Za-z0-9_-]{1,64}$`. It is used at `components/dashboard.tsx:83` and `lib/useSimulationStream.ts:27`.

**Tech stack:** TypeScript, Vitest.

## Root cause

`crypto.randomUUID()` is a secure-context API, available only on HTTPS and localhost. On `http://192.168.x.x:3000` it is `undefined`, so pressing Start throws a `TypeError` and nothing happens.

## File map

- `frontend/src/lib/simulation-id.ts` (new, + `.test.ts`).
- `frontend/src/components/dashboard.tsx`, `frontend/src/lib/useSimulationStream.ts`: use the helper.
- `README.md` demo section: one line on LAN use (set `GREENWAVE_CORS_ORIGINS` to the LAN origin for backend mode).

## Tasks

- [x] RED (`simulation-id.test.ts`):
  - with `randomUUID` → its value;
  - without it → 32 lowercase hex characters matching the pattern;
  - 1 000 ids from the fallback are unique;
  - the output always matches `/^[A-Za-z0-9_-]{1,64}$/`.
- [x] GREEN; replace both call sites (grep that `randomUUID` remains only in the helper).
- [x] Frontend gate.
- [x] Browser: in a mock production build at `http://127.0.0.1:3100`, run `delete crypto.randomUUID` with `page.addInitScript`, pick an incident and press Start. The run starts and there are no console errors. Evidence under `.tmp/playwright/repo-audit/m7/`.

## Acceptance

- Start succeeds without `randomUUID`; ids remain contract-valid.
- Frontend gate green.
