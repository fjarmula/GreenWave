import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it } from "vitest";
import { DriverStatus } from "./DriverStatus";
import { initialSimulationState } from "@/lib/simulation-state";
import { completed, request, route, tick } from "@/lib/comparison/fixtures.test-support";
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

const finished = (onFoot: boolean) => ({
  ...initialSimulationState,
  simulationState: "FINISHED" as const,
  startRequest: request,
  routeData: {
    ...route(),
    destination_on_foot: onFoot
      ? { access_point: { lat: 50.06, lng: 19.91 }, distance_m: 650, seconds: 464 }
      : null,
  },
  completion: completed(383),
});
it("names the access point and the walk when the incident is off the road", () => {
  const html = renderToStaticMarkup(<DriverStatus state={finished(true)} onStop={() => {}} />);
  expect(html).toMatch(/Arrived at access point in [^<]+ · 650 m on foot/);
});
it('labels the ETA "to access point" with an on-foot leg', () => {
  const running = (onFoot: boolean) => ({
    ...initialSimulationState,
    simulationState: "RUNNING" as const,
    startRequest: request,
    routeData: {
      ...route(),
      destination_on_foot: onFoot
        ? { access_point: { lat: 50.06, lng: 19.91 }, distance_m: 650, seconds: 464 }
        : null,
    },
    liveTelemetry: tick(2),
  });
  const html = (onFoot: boolean) =>
    renderToStaticMarkup(<DriverStatus state={running(onFoot)} onStop={() => {}} />);
  expect(html(true)).toContain("ETA to access point");
  expect(html(false)).not.toContain("to access point");
});
it("keeps the plain arrival copy without an on-foot leg", () => {
  const html = renderToStaticMarkup(<DriverStatus state={finished(false)} onStop={() => {}} />);
  expect(html).toMatch(/Arrived in [^<]+</);
  expect(html).not.toContain("on foot");
});

it("shows ITS failure and identifies retained controller state", () => {
  const state = {
    ...initialSimulationState,
    startRequest: request,
    simulationState: "CANCELLED" as const,
    cancelReason: "ITS_TIMEOUT" as const,
  };
  const html = renderToStaticMarkup(<DriverStatus state={state} onStop={() => {}} />);
  expect(html).toContain("acknowledgement timed out");
  expect(html).toContain("Last simulated controller report");
});
