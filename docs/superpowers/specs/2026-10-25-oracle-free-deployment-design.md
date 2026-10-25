# Oracle Always Free deployment

## Intent and acceptance

Prepare the existing simulation-only PoC for a single Ubuntu VM, preserving backend routing,
dispatch, both simulation modes, comparison, diagnostics, and the phone presentation.
The human creates external accounts, supplies credentials and DNS, and provisions the VM.
No cloud resources are created and nothing is pushed or published by this change.

## Design

- Add a separate production Compose file; keep the development workflow intact.
- Build a minimal Next.js standalone image and a Python image with locked production dependencies.
  Both application processes run as non-root users. Python runs one worker, with no reload.
- Caddy provides automatic HTTPS, a shared demo password, and same-origin `/api/` proxying
  without buffering SSE. Only ports 80/443 are published. Persist Caddy's certificate state.
- Mount the complete existing processed dataset and matching raw manifest read-only. Do not
  bake data into images, download a different extract, or run ETL during startup.
- Build the frontend with backend transport, the public HTTPS origin, and the supplied CARTO
  browser key. Add the key only to trusted CARTO basemap requests, including subordinate
  tile/style/glyph/sprite resources. Preserve attribution and existing theme behavior.
- Keep passwords, environment files, raw data, and generated artifacts out of Git.
- Provide account, free-tier, SSH, firewall, free DNS, data transfer, startup, verification,
  backup, update, and rollback instructions. Clearly state shared operation and volatile session
  semantics. No real traffic actuation, persistence redesign, or multi-tenant sessions.

## Builder decisions

Use Docker Compose and Caddy on a single Oracle Ampere A1 VM. Use a free DuckDNS hostname (or
an existing owned domain); account creation remains manual. Basic authentication protects the
shared demonstration and works on the same origin for HTTP and EventSource. These are implementation
choices, not additional product features requested by the human.

## Verification

Test CARTO key handling before implementation. Validate rendered production Compose and Caddy
configuration, build and run both production images on ARM64, load the current GIS dataset, and
exercise HTTP, authentication, and SSE through the proxy. Run frontend quality checks and backend
checks. Public DNS, ACME issuance, Oracle capacity, and a real browser-key acceptance require
the human's provisioned resources and must not be claimed from local checks.
