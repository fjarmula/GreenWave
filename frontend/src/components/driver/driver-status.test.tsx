import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DriverStatus } from "./DriverStatus";
import { initialSimulationState } from "@/lib/simulation-state";
import { request, route, tick } from "@/lib/comparison/fixtures.test-support";
it("shows vehicle-specific simulated status, stale feedback and recoverable Stop", () => {
  const state = {
    ...initialSimulationState,
    simulationState: "RUNNING" as const,
    startRequest: { ...request, vehicle_type: "FIRE_TRUCK" as const },
    routeData: route(),
    liveTelemetry: tick(2),
    connection: "reconnecting" as const,
    stopError: "Offline",
  };
  const html = renderToStaticMarkup(<DriverStatus state={state} onStop={() => {}} />);
  for (const text of [
    "Fire truck",
    "Simulated",
    "Last received",
    "Offline",
    "Retry Stop",
    "ETA",
    "145 s faster · simulated",
  ])
    expect(html).toContain(text);
});
it("never presents a disabled run as enabled driver telemetry", () => {
  const html = renderToStaticMarkup(
    <DriverStatus
      state={{
        ...initialSimulationState,
        startRequest: { ...request, green_wave_mode: "DISABLED" },
      }}
      onStop={() => {}}
    />,
  );
  expect(html).toContain("Enabled simulation required");
  expect(html).not.toContain("km/h");
});
