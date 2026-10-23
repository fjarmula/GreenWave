import { tickEventExample } from "@/lib/transport/__fixtures__/architecture-examples";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KpiHeader } from "@/components/hud/KpiHeader";
import {
  initialSimulationState,
  type SimulationPhase,
  type SimulationState,
} from "@/lib/simulation-state";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));

function stopButton(markup: string): string | undefined {
  return markup.match(/<button[^>]*data-testid="stop-simulation"[^>]*>.*?<\/button>/)?.[0];
}

describe("KpiHeader phone Stop", () => {
  it("offers a compact Stop below the desktop breakpoint while running", () => {
    state = { ...initialSimulationState, simulationState: "RUNNING" };
    const button = stopButton(renderToStaticMarkup(<KpiHeader onStop={() => undefined} />));

    expect(button).toContain("lg:hidden");
    expect(button).toContain("Stop");
    expect(button).toContain('aria-label="Stop simulation"');
  });

  it("shows the stop in progress", () => {
    state = { ...initialSimulationState, simulationState: "RUNNING", stopRequested: true };
    const button = stopButton(renderToStaticMarkup(<KpiHeader onStop={() => undefined} />));

    expect(button).toContain(' disabled=""');
    expect(button).toContain('aria-busy="true"');
  });

  it.each(["SETUP", "FINISHED", "CANCELLED", "ERROR"] as SimulationPhase[])(
    "has no Stop when %s",
    (phase) => {
      state = { ...initialSimulationState, simulationState: phase };
      expect(stopButton(renderToStaticMarkup(<KpiHeader onStop={() => undefined} />))).toBe(
        undefined,
      );
    },
  );
});

describe("KpiHeader time saved", () => {
  function savedMarkup(saved: number) {
    state = {
      ...initialSimulationState,
      simulationState: "RUNNING",
      liveTelemetry: {
        schema_version: "1.0",
        is_simulated: true,
        event_type: "SIMULATION_TICK",
        simulation_id: "SIM-kpi",
        tick: 30,
        timestamp: "2026-10-22T12:00:00Z",
        ambulance: {
          id: "AMB-KRA-01",
          position: { lat: 50.06, lng: 19.94 },
          speed_kmh: 40,
          status: "EN_ROUTE",
        },
        kpi_metrics: { current_time_saved_sec: saved, total_time_elapsed_sec: 30 },
        intersections: [],
        signal_phases: [],
        its_requests: [],
        its_observed_at_simulated_sec: null,
      },
    };
    const markup = renderToStaticMarkup(<KpiHeader />);
    return markup.slice(markup.indexOf("Time saved")).match(/<strong class="([^"]*)">([^<]*)</)!;
  }

  it.each([
    [42, "+42s", "text-emerald-600"],
    [0, "+0s", "text-muted-foreground"],
    [-12, "−12s", "text-amber-700"],
  ])("colours %i s saved by its sign and keeps the sign", (saved, text, colour) => {
    const [, classes, value] = savedMarkup(saved);

    expect(value).toBe(text);
    expect(classes.split(" ")).toContain(colour);
    if (saved <= 0) expect(classes).not.toContain("emerald");
  });
});

describe("KpiHeader run outcome", () => {
  it.each([
    ["FINISHED", null, "SIMULATION FINISHED", "Simulation finished"],
    ["CANCELLED", "STOPPED", "SIMULATION STOPPED", "Simulation stopped"],
    ["CANCELLED", "SERVER_ERROR", "SERVER ERROR", "Simulation server error"],
    ["CANCELLED", "SUPERSEDED", "SIMULATION CANCELLED", "Simulation cancelled"],
    ["ERROR", null, "TELEMETRY STOPPED", "Simulation error"],
  ] as const)("%s (%s): badge %s, phone chip %s", (phase, reason, badge, chip) => {
    state = { ...initialSimulationState, simulationState: phase, cancelReason: reason };
    const markup = renderToStaticMarkup(<KpiHeader onStop={() => undefined} />);

    expect(markup).toContain(badge);
    const phoneChip = markup.match(/<button[^>]*data-testid="run-outcome"[^>]*>(.*?)<\/button>/);
    expect(phoneChip?.[0]).toContain("lg:hidden");
    expect(phoneChip?.[1]).toContain(chip);
    expect(phoneChip?.[1]).toContain("Summary");
  });

  it.each(["SETUP", "RUNNING"] as SimulationPhase[])("has no outcome chip while %s", (phase) => {
    state = { ...initialSimulationState, simulationState: phase };
    expect(renderToStaticMarkup(<KpiHeader onStop={() => undefined} />)).not.toContain(
      "run-outcome",
    );
  });
});

describe("KpiHeader vehicle type", () => {
  it.each([
    ["FIRE_TRUCK", "Fire truck", "lucide-flame-kindling"],
    ["POLICE_CAR", "Police car", "lucide-siren"],
  ] as const)("shows a %s run as %s", (type, label, icon) => {
    state = {
      ...initialSimulationState,
      simulationState: "RUNNING",
      startRequest: {
        simulation_id: "SIM-kpi",
        origin: { lat: 50.05, lng: 19.95 },
        destination: { lat: 50.06, lng: 19.94 },
        traffic_density_multiplier: 1.5,
        enable_cascade_mode: true,
        playback_speed: 1,
        vehicle_type: type,
        green_wave_mode: "ENABLED",
        its_scenario: "NOMINAL" as const,
      },
    };
    const markup = renderToStaticMarkup(<KpiHeader />);

    expect(markup).toContain(label);
    expect(markup).toContain(icon);
    expect(markup).not.toContain("lucide-ambulance");
  });

  it("falls back to the ambulance before a run", () => {
    state = initialSimulationState;
    const markup = renderToStaticMarkup(<KpiHeader />);

    expect(markup).toContain("lucide-ambulance");
    expect(markup).toContain("Ambulance");
  });
});

it.each(["ITS_REJECTED", "ITS_TIMEOUT", "ITS_HOLD_EXPIRED"] as const)(
  "does not present successful savings after %s",
  (reason) => {
    state = {
      ...initialSimulationState,
      simulationState: "CANCELLED",
      cancelReason: reason,
      liveTelemetry: {
        ...tickEventExample,
        kpi_metrics: { total_time_elapsed_sec: 25, current_time_saved_sec: 29 },
      },
    };
    const html = renderToStaticMarkup(<KpiHeader />);
    expect(html).not.toContain("+29s");
    expect(html).toContain("No completed savings");
  },
);
