import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { IntersectionList } from "@/components/hud/IntersectionList";
import type { SimulationState } from "@/lib/simulation-state";

const state = vi.hoisted(() => ({ current: null as SimulationState | null }));

vi.mock("@/components/simulation-provider", () => ({
  useSimulationState: () => state.current,
}));

function reviewState(): SimulationState {
  return {
    simulationState: "RUNNING",
    startRequest: null,
    routeData: {
      green_wave_mode: "ENABLED",
      schema_version: "1.0",
      is_simulated: true,
      simulation_id: "detail",
      status: "INITIALIZED",
      route_geometry: {
        type: "LineString",
        coordinates: [
          [19.9, 50.0],
          [20.0, 50.1],
        ],
      },
      total_distance_m: 1000,
      estimated_normal_time_sec: 100,
      estimated_greenwave_time_sec: 70,
      intersections_on_route: ["INT-REVIEW"],
      route_intersections: [
        {
          id: "INT-REVIEW",
          name: null,
          kind: "midblock_signal",
          position: { lat: 50.05, lng: 19.95 },
          distance_along_route_m: 500,
          signal_count: 2,
          approach_count: 3,
          needs_review: true,
          cascade_targets: [],
        },
      ],
      origin_snapped: { position: { lat: 50.0, lng: 19.9 }, snap_distance_m: 0 },
      destination_snapped: { position: { lat: 50.1, lng: 20.0 }, snap_distance_m: 0 },
    },
    liveTelemetry: {
      signal_phases: [],
      schema_version: "1.0",
      is_simulated: true,
      event_type: "SIMULATION_TICK",
      simulation_id: "detail",
      tick: 1,
      timestamp: "2026-10-19T00:00:00Z",
      ambulance: {
        id: "AMB-KRA-01",
        position: { lat: 50.0, lng: 19.9 },
        speed_kmh: 50,
        status: "APPROACHING_INTERSECTION",
      },
      kpi_metrics: { current_time_saved_sec: 1, total_time_elapsed_sec: 1 },
      intersections: [
        {
          id: "INT-REVIEW",
          name: null,
          state: "CLEARING",
          is_cascade: false,
          tti_seconds: 12,
          is_active_corridor: true,
        },
      ],
    },
    lastTick: 1,
    connection: "open",
    itsLog: [],
    completion: null,
    cancelReason: null,
    error: null,
    stopRequested: false,
    stopError: null,
  };
}

describe("IntersectionList", () => {
  it("shows unnamed, review-flagged intersection detail", async () => {
    state.current = reviewState();

    const markup = renderToStaticMarkup(<IntersectionList />);

    expect(markup).toContain("Unnamed intersection");
    expect(markup).toContain("Mid-block signal");
    expect(markup).toContain("2 signals");
    expect(markup).toContain("Source data flagged for review");
    await expect(`${markup}\n`).toMatchFileSnapshot("./__snapshots__/IntersectionList.review.html");
  });

  it("falls back to the start-response name when a tick carries none", () => {
    const current = reviewState();
    current.routeData!.route_intersections[0].name = "Aleja Kijowska / Juliusza Lea";
    state.current = current;

    const markup = renderToStaticMarkup(<IntersectionList />);

    expect(markup).toContain("Aleja Kijowska / Juliusza Lea");
    expect(markup).not.toContain("Unnamed intersection");
  });
});

describe("IntersectionList ordering", () => {
  /** Ticks in a scrambled order; distances give the route order INT-A … INT-D. */
  function orderingState(): SimulationState {
    const current = reviewState();
    const distances: Record<string, number> = {
      "INT-A": 100,
      "INT-B": 200,
      "INT-C": 300,
      "INT-D": 400,
    };
    current.routeData!.route_intersections = Object.entries(distances).map(([id, distance]) => ({
      ...current.routeData!.route_intersections[0],
      id,
      name: `Junction ${id.slice(-1)}`,
      needs_review: false,
      distance_along_route_m: distance,
    }));
    const tick = (id: string, tti: number | null) => ({
      id,
      name: `Junction ${id.slice(-1)}`,
      state: tti === null ? ("NORMAL" as const) : ("CLEARING" as const),
      is_cascade: false,
      tti_seconds: tti,
      is_active_corridor: tti !== null,
    });
    current.liveTelemetry!.intersections = [
      tick("INT-D", 40),
      tick("INT-B", null),
      tick("INT-C", 12),
      tick("INT-A", null),
    ];
    return current;
  }

  const ids = (markup: string) =>
    [...markup.matchAll(/font-mono text-xs">(INT-[A-D])</g)].map(([, id]) => id);

  it("lists upcoming signals first in route order, then passed ones in a collapsed group", () => {
    state.current = orderingState();
    const markup = renderToStaticMarkup(<IntersectionList />);
    const [upcoming, passed] = markup.split("<details");

    expect(ids(upcoming)).toEqual(["INT-C", "INT-D"]);
    expect(passed).toBeDefined();
    expect(passed).not.toMatch(/^[^>]*\sopen/);
    expect(passed).toMatch(/<summary[^>]*>.*?Passed \(2\)<\/summary>/);
    expect(ids(passed)).toEqual(["INT-A", "INT-B"]);
  });

  it("has no passed group before any signal is passed", () => {
    state.current = reviewState();
    expect(renderToStaticMarkup(<IntersectionList />)).not.toContain("<details");
  });

  it("calls the list route signals, since it holds all of them", () => {
    state.current = orderingState();
    const markup = renderToStaticMarkup(<IntersectionList />);

    expect(markup).toMatch(/<h2[^>]*>Route signals <span[^>]*>\(TTI\)<\/span><\/h2>/);
    expect(markup).not.toContain("Active corridor signals");
  });
});
