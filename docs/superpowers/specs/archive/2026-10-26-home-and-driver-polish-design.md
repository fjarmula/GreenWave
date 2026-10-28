# Home and Driver polish: design

Second polish pass on branch `feat/ui-polish`, agreed with the human on 2026-10-26 through mockups (`.superpowers/brainstorm/`). Frontend plus one backend export script; no API or schema change.

## Home screen

1. **Background: hybrid.** A real Green Wave run plays behind the home content on the Aleje Trzech Wieszczów, Kraków (Monte Cassino / Szwedzka to Słowackiego / Mazowiecka, 11 junctions with signals). A vehicle dot drives the corridor on a 16 s loop. Each signal shows red ahead, turns green when the vehicle is within 14% of the route, and goes idle 5% after it passes. A green trail of 22% route length follows the vehicle.
   - **Wide screens (≥ 768px): live map.** Uses the app's MapLibre basemap (CARTO positron/dark-matter by theme). It is dimmed, saturation 0.5, and non-interactive, with no zoom controls. The route is framed in the right half of the screen.
   - **Narrow screens (< 768px): static drawing.** The same corridor drawn over a static line drawing of Kraków's real roads in three tiers. Phones never load the map code.
   - **Fallback:** if WebGL is unavailable or the map fails to load, wide screens show the static drawing instead.
   - **Data:** the road drawing, route and signals come from our processed dataset (`road_edges.parquet`, `intersections.parquet`, EPSG:2178), baked by a committed backend script into committed frontend files, with provenance recorded.
2. **Readability.** A scrim keeps text readable: on desktop it fades from the left and the bottom; on phone from the bottom. On wide screens a caption at the right names the corridor: "Aleje Trzech Wieszczów · 11 signalised junctions · real geometry", a legend (Vehicle / Priority green), and "Simulated".
3. **Attribution.** Both modes show map attribution (OSM ODbL; CARTO on the live map) behind the ⓘ pattern from the first pass.
4. **Mode icons.** The Green Wave card uses the wave glyph from the logo (stroke plus vehicle dot). Standard traffic uses S1, a "stop-and-go" stepped line with the vehicle dot. Comparison uses C1, two lanes (wave over steps), with the Green Wave vehicle ahead. Stroke 2 to 2.2, round caps, `currentColor`, drawn for 18px.
5. **One screen, no scrolling.** The old corridor illustration is removed. Cards sit at the bottom; on phone they become compact rows. Short screens (height < 700px) fall back to normal scrolling instead of clipping. The "Simulation only" disclaimer stays visible.
6. **Motion.** Reduced motion shows a still frame at 55% progress. The loop pauses while the tab is hidden.

## Driver screen only

7. **Setup panel that gets out of the way.**
   - **Phone.** The driver setup sheet gains a third, minimized height: the grabber plus the card's first row, which shows "Where's the incident?" or the chosen incident.
     - Panning, zooming or rotating the map by hand minimizes it.
     - Picking the incident on the map brings it back to its normal height.
     - Tapping the minimized bar or its grabber restores it. Dragging moves between all three heights.
   - **Desktop.** The floating setup card gets a minimize button in its own corner. When minimized it becomes a pill ("Driver setup · <incident or 'no incident'>") that restores it. No auto-minimize on desktop.
   - **Scope.** Minimizing applies to the driver setup sheet only. The live-run driver sheet and the other views keep their two heights.
8. **Compact header.** Driver's header is one row: a page-menu button showing the current page ("Driver / Setup" or "Driver / Simulation") that opens a popover with all six destinations, followed by the theme toggle and Focus.
   - The tab strip and the Details button are gone from Driver; the setup card's own minimize replaces Details.
   - The popover closes on Escape (focus returns to the button), on an outside press and on navigation. It scales in from the button (0.97, 200ms, ease-out), with opacity only under reduced motion.

## Non-goals

No change to Green Wave, Standard traffic or Comparison screens beyond shared components keeping their current behaviour. No real signal actuation. No new npm dependencies. No API or schema change.
