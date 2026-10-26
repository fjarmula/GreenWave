# UI polish pass: design

Post-deployment visual fixes requested by the human on 2026-10-26. Frontend only; no schema, backend or contract changes.

## Requirements

1. **Stable navigation.** Opening Diagnostics must not move the tab bar. Diagnostics uses the same pinned glass header (navigation left, actions right) as the map workspaces.
2. **Follow vehicle in Dispatch settings, in every live view.** Green Wave, Standard traffic, Comparison and Driver each show the read-only Dispatch settings chip while a run is live. Its popover has a Follow vehicle switch: on resumes camera following, off returns to the route overview. Comparison follows the vehicle on both maps.
3. **Attribution behind an info button.** The map attribution is always collapsed to MapLibre's round ⓘ button. Hovering it (fine pointers) or clicking/tapping it shows the full text. Attribution must stay reachable (OSM licence).
4. **New logo.** A clean sine-wave mark: a rounded `--go` tile with 1.5 periods of a white sine stroke and a vehicle dot on the crest. Used in the Home header and as the favicon. Static, no animation.
5. **ITS feedback redesign.** Replace the native `<select>` with a 2×2 radio-card grid matching the `hud-segmented` family: title, mono caption, tone dot (Nominal go, Delayed caution, Rejected emergency, No feedback muted). Disabled (Green Wave off) shows Nominal locked with the reason "Green Wave off". Arrow keys move between options. Selection change is not animated; press uses the existing `pressable` scale.
6. **Diagnostics actions in the header.** "Return to simulation" and "Clear observed history" move into the header actions.
7. **Navigation overflow hint.** The scrolling tab bar fades at the edge that has more tabs.
8. **Popover entrance.** The Dispatch settings popover scales in from the chip: scale 0.96 + opacity 0 → 1, `var(--dur-enter)` (200ms), `var(--ease-out)`, `transform-origin` at the chip. Exit stays instant. Reduced motion: opacity only.
9. **Per-route titles.** Browser tab title is `<Page> · ER-GreenWave`; Home stays `ER-GreenWave`.

Items 6–9 are trial changes; the human may revert any of them after review.

## Non-goals

No real signal actuation, no new dependencies, no change to camera policy rules in `lib/camera-policy.ts`.
