# Simulation JSON inspection

The user requested full request/response JSON inspection from diagnostics, with a related entry point on intersection cards. Use click rather than hover, formatted copyable content, and an immutable snapshot while the simulation continues.

Capture actual serialized HTTP request bodies and original response text at the existing transport boundary, before parsing/validation can discard envelopes or error bodies. GET and Stop requests explicitly show no JSON request body; relative endpoint/query identifies them. Capture named SSE event data, labeling accepted/rejected payloads without changing validation or delivery. No headers or credentials are captured. Mock adapter data remains labeled synthetic, never represented as a backend wire exchange.

Keep the existing 200-entry bound, coalesce consecutive tick observations to the latest payload, cap each body at 2 MiB and retained capture text at 8 MiB. Oversized bodies are omitted with an explicit explanation rather than silently truncated. Bodies and query parameters remain only in this browser session, cleared by the existing history action/reload. This explicitly supersedes the previous diagnostics metadata-only choice, as requested by the user.

Recent activity offers View JSON and a native modal with request/response selectors, metadata, selectable formatted text and Copy of the original captured text. Opening freezes the selected exchange even if coalescing, clearing or eviction occurs. Native dialog handles Escape, focus trapping and focus restoration. The dialog stays within dynamic viewport bounds, with horizontal scrolling for JSON and safe-area padding. Each intersection offers the current full validated tick, labeled as validated telemetry containing that intersection, rather than claiming it is an outgoing controller command.

Plan: add failing transport/store/presentation tests; implement bounded capture and wire integration; add reusable JSON viewer and intersection entry; verify actual requests/responses/errors, SSE, frozen content, Copy, keyboard and phone overflow via playwright-cli; run the full frontend gate and update documentation. No dependency, backend lifecycle or public-contract change.

## Implementation and verification

Implemented with `DiagnosticCapture`, bounded history, transport-level HTTP/SSE capture and a shared native JSON dialog. Backend payload text is observed before parsing; validation still decides delivery and accepted/rejected labels. Synthetic adapter values are labeled separately. JSON formatting preserves original number/string tokens, including integers beyond JavaScript numeric precision; Copy preserves the original body text. Opening a viewer stores its own selection outside the changing activity/intersection rows.

TDD evidence: `.tmp/multiview/json-red.log`, `json-intersection-red.log`, `json-format-red.log`, `json-validation-red.log` and `json-copy-red.log` reproduce missing capture/viewer, numeric-token formatting and validation/copy-label cases before their changes. The focused transport/store/viewer checks pass. The intersection golden file was reviewed and updated for the new action.

Full frontend gate passes: lint, typecheck, format check, 71 files / 542 tests, production build (`.tmp/multiview/json-gate.log`). Existing timeout, cancellation, stale/reconnect, response validation, Stop and adapter identity tests remain passing. `git diff --check` and graph refresh pass (`.tmp/multiview/json-graph.log`). No dependency, generated-contract or backend source change.

Browser evidence under `.tmp/playwright/multiview/json/`: `inspect.log` compares request/response viewer and clipboard values with actual local backend network bodies, verifies the station envelope, frozen intersection tick while simulation advances, Escape/focus restoration, empty GET request labeling, history clearing and dialog bounds at 320×568, 390×844 and 844×390. `error.log` uses an HTTP 422 route fixture to verify full error body, exact copying, escaped script-like content and dark phone rendering. Screenshots: `request-desktop.png`, `request-phone.png`, `intersection.png`, `error-dark.png`, `error-phone-dark.png`. All browser automation used playwright-cli through bash; artifacts remain ignored. Physical phone touch, browser chrome and software keyboard behavior are not represented as verified.

Design self-review:

| Before | After | Why |
| --- | --- | --- |
| Activity contains only metadata | Explicit View JSON with request/response direction and status | Inspect what actually crossed the transport boundary |
| Live telemetry replaces the inspected value | Frozen modal selection independent of changing rows | Keep text stable for reading and copying |
| HTTP 200 could conceal a rejected schema | Distinct accepted/rejected validation label | Preserve honest diagnostics and unchanged runtime validation |
| Hover-only inspection would exclude touch | Native modal, 44px actions, keyboard Escape and focus return | Support phone and keyboard access |

Proposed commit: `feat: inspect simulation request and response JSON`.
