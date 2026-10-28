# Architecture Decision Records

ADRs capture consequential, durable architecture decisions. They are not task notes or implementation logs.

Create the next sequential file as `NNNN-short-title.md`, copied from `0001-template.md`. Set its status to `Proposed` first. Change to `Accepted` only after maintainer approval. Never rewrite an accepted decision; create a new ADR that supersedes it.

Agents must read relevant accepted ADRs before proposing changes in that area. Link the ADR from the pull request when a change implements or supersedes it.

## Index

Statuses are copied from each ADR's own `Status` line; only a maintainer changes them. "Implemented in" names the commit (or pull request) on `main` that first shipped the decision.

| ADR | Title | Status | Implemented in |
| --- | --- | --- | --- |
| [0001](0001-template.md) | Template | n/a | `43faa75` |
| [0002](0002-agent-workflow-setup.md) | Agent workflow setup | Accepted; superseded in part by 0004 | `43faa75` |
| [0003](0003-simulation-contract-v1.md) | Simulation contract v1 | Accepted; superseded in part (see its note) | `074653d` |
| [0004](0004-graphify-artifacts-local-only.md) | Graphify artifacts are local only | Accepted | `b84670f` |
| [0005](0005-road-attribute-time-factors.md) | Road-attribute time factors | Proposed | `02c07a5` |
| [0006](0006-incident-dispatch-contract.md) | Incident dispatch contract | Accepted (pending human review) | `b8051e0` |
| [0007](0007-server-error-cancel-reason.md) | Server-error cancel reason | Proposed | `0410f92` |
| [0008](0008-live-comparison-pair.md) | Live comparison pair | Accepted | #45 (`7deff49`) |
| [0008](0008-simulated-its-feedback.md) | Simulated ITS request and feedback | Proposed | #42 (`9e65ffd`) |
| [0009](0009-on-foot-incident-access.md) | On-foot access to off-road incidents | Proposed | #45 (`7deff49`) |
| [0010](0010-rolling-junctions-and-hold-coverage.md) | Rolling junctions, hold coverage and the floored standard crossing | Proposed | `0b7729f` |
| [0011](0011-standard-run-estimate.md) | Exact standard-run estimate and the walk shown apart | Proposed | `0b7729f` |
| [0012](0012-on-site-dispatch.md) | On-site dispatch | Proposed | `0b7729f` |
| [0013](0013-municipal-address-provenance.md) | Municipal address provenance (EMUiA) | Proposed | #52 (`b650cbb`) |
| [0014](0014-resource-aware-ambulance-dispatch.md) | Resource-aware ambulance dispatch (PRM roster) | Proposed | #52 (`b650cbb`) |

**Two ADRs numbered 0008.** The live comparison pair and the simulated ITS feedback were written on parallel branches and both took 0008 before either merged. Both numbers are cited in code, commits and other ADRs, so they are not renumbered; cite them by number and title (for example "ADR 0008 live comparison pair"). The next new ADR is 0015.
