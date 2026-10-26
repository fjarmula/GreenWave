# Responsive map workspace design

## Intent and approved scope

Make the whole application adapt to available screen space, consistently across Driver,
Green Wave, Standard traffic, Comparison, Home and Diagnostics. Give the map and vehicle
priority over navigation and logs. The user approved implementation of this scope in chat.

## Required behavior

- At widths below 768px, navigation is a compact, labelled menu containing all six
  destinations. It opens on demand, closes after selection or Escape, and does not
  require horizontal scrolling. At 768px and above retain the standard top-left desktop
  navigation. Resizing must change presentation without losing simulation/scenario state.
- Driver, Green Wave and Standard use a draggable, collapsible sheet on phones and
  the full floating inspector on desktop. Driver-specific signal guidance remains.
  Comparison retains its two desktop maps and one selectable phone map; its setup
  form uses a phone sheet as well. Home and Diagnostics use the same navigation policy.
- Details hides/restores panels, and Focus hides navigation, status and panels in every
  map workspace. Keep a visible restore control and simulation provenance. Keep camera
  controls available in Focus so a user can follow or reframe without reopening logs.
- Home and Diagnostics expand with the viewport: 96% width up to 1800px on desktop,
  with comfortable responsive padding. Maps remain edge-to-edge. Preserve phone layout
  readability and prevent horizontal page overflow at 320px.
- Home corridor backdrop and legend use the simulation's saturated phase swatches: red
  #ef4444, green #22c55e, yellow #facc15. Keep accessible text/UI semantic colors and
  light/dark surfaces; do not brighten text at the cost of contrast.
- Follow vehicle smoothly centers and zooms to at least zoom 17 from overview; preserve
  a closer zoom. Use MapLibre easeTo, 280ms, default MapLibre easing, with reduced motion
  respected. Do not overwrite the transition with per-frame tracking. Afterward follow
  the displayed marker. Manual pan suspends follow; zooming out below 16 restores overview.
  Wheel/pinch entry above 16.5 also follows. Show route returns to route overview.
  Stale/ended runs never auto-track; controls must not promise following when unavailable.
- Phone panel content scrolls independently without moving the map or dragging the sheet
  from a normal content scroll. Drag the sheet using its handle; preserve tap/keyboard
  alternatives. Respect safe areas, dynamic viewport height, and 44px touch targets.

## Constraints and builder decisions

Simulation only; no backend, contracts, actuation, dependencies or lockfile changes.
Preserve one shared runtime and stable map instance across setup/live and responsive changes.
Use the existing 768px breakpoint, capability queries for touch styling, and existing
BottomSheet/WorkspaceShell boundaries. Reuse the current PageMenu phone navigation; desktop
navigation stays in the document for SSR. Test browser viewport behavior; actual touch feel,
Safari browser chrome and physical phone safe areas require a real device follow-up.


## Current-main adaptation

Base: `4dfc1fcd`, explicitly refreshed by the user. Preserve its new Kraków corridor backdrop,
shared WorkspaceHeader, PageMenu, minimized phone sheets and FollowProvider settings switch.
Home content grows to 96% up to 1800px within the current full-screen backdrop composition.
Desktop Driver adopts the standard navigation and full inspector. Phone page menus include
appearance controls so header actions cannot crowd navigation. Saturated signal colors apply
to both the live and static home backdrops, without desaturating the live canvas.
