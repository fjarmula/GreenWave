# Route preview and bounded monitoring panels

Implement the user's route-preview and independent-sidebar-scrolling requirements.
Ranking returns each candidate's existing planned geometry; setup renders the page's chosen
candidate only while ranking is ready. The existing abort/sequence handling owns preview
freshness. No preview operation starts sessions or dispatches ITS events. On-site candidates
have no driven route. Mock preview uses the same synthetic straight line as mock playback.
Playback replaces the dashed neutral preview with the existing live route. Simulation start
retains its deterministic server-side planning and validation; no client geometry is trusted.
Both modes retain their existing station selection semantics and share the same path planner.

Desktop live details use a height-bounded flex layout: controls at natural size and two equal
monitoring rows with fixed headers and independently scrolling bodies. Very short screens
may scroll controls separately. Phone sheets retain their existing gesture/scroll model,
with bounded monitoring sections. Preserve PL/EN, markers, timing, signals and dependencies.
