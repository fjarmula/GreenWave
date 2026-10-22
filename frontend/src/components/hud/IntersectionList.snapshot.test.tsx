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
