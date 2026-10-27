# Workspace controls and signal diagnostics

## Intent and acceptance

Implement the user's workspace cleanup on a dedicated feature branch and open a PR after verification.

- Follow responds to one click, including after showing the route or manually moving the map.
- A standalone start action remains accessible outside scrolling settings, including hidden details, focus mode and minimized phone sheets. Preserve pending, unavailable ranking, replacement and on-site dispatch semantics.
- Navigation uses concise page labels without setup/developer subtitles. Every page shows the existing logo with an accessible Home link in workspaces.
- Remove pedestrian light rendering from the map, retaining canonical pedestrian phase data in diagnostics JSON.
- Diagnostics exposes colors and movement identity for supported vehicle approaches and pedestrian crossings. Use existing signal phases and controlled road-edge identities; do not fabricate individual lanes when the dataset only identifies approaches. Priority targets only route vehicle movements green; conflicting vehicle and pedestrian movements red, preserving clearance transitions.

## Constraints and builder choices

Simulation only; no physical actuation. Reuse the current components and dependencies. Canonical Pydantic schemas and generated contracts remain authoritative. Preserve ordinary cycles outside priority. Retain existing navigation, settings, comparison and driver behaviors. The user authorized implementation, branch creation and PR publication; routine milestones run without checkpoints.

The shared shell owns the persistent action; setup forms own only editable settings. The shared header owns workspace branding. Protocol additions, if needed, are additive to existing signal phases and stay in this PR when small enough to verify together.
