# Mobile dispatch access: design

## Intent

A dispatcher on a narrow phone should be able to see and use every setup control, even when real station ranking includes long names. The map-first layout and established visual system remain intact.

## Decisions

- Let the setup grid item, panel, and ranking text shrink to the available width. Station identity may wrap or truncate if its full text remains available through an existing or accessible detail affordance.
- Keep Ambulance, Fire, and Police as three reachable choices. Keep Start and the other setup controls within the viewport at 320 px and 390 px.
- Test with long plausible station names, including an unbreakable label, through test data rather than altered production data. Preserve desktop proportions and both light and dark themes.

## Constraints and non-goals

- Do not mask an oversized layout with page-level clipping or horizontal scrolling. Preserve current minimum control heights and visible keyboard focus.
- No routing, dispatch, contract, dependency, or lockfile change. No broad UI redesign.
- Browser checks use `playwright-cli` through bash and write outputs only under `.tmp/playwright/`.

## Acceptance criteria

- At 320 px and 390 px, the setup panel and all three vehicle buttons remain inside the viewport; each button selects the corresponding type and updates ranking.
- Start, incident input, traffic density, mode, cascade, and playback controls remain visible and usable. Long station text does not widen the document.
- At 1280 px, the sidebar/map relationship is unchanged. Focus and theme behavior remain legible.
