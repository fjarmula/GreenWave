import { expect, it } from "vitest";
import { selectMapState } from "./map-render-state";
import { initialSimulationState } from "./simulation-state";
import { request, route } from "./comparison/fixtures.test-support";
it("setup never renders a different active run's route or request", () => {
  const active = {
    ...initialSimulationState,
    startRequest: request,
    routeData: route(),
    simulationState: "RUNNING" as const,
  };
  expect(selectMapState(active, false).routeData).toBeNull();
  expect(selectMapState(active, false).startRequest).toBeNull();
  expect(selectMapState(active, true)).toBe(active);
});
