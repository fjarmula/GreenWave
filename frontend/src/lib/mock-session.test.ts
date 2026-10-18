import { describe, expect, it } from "vitest";
import { createMockSession, stepMockSignals } from "@/lib/mock-session";
import type { SimulationStartRequest } from "@/types/telemetry";

function requestWithCascade(enableCascadeMode: boolean): SimulationStartRequest {
  return {
    simulation_id: "cascade",
    origin: { lat: 50.06, lng: 19.95 },
    destination: { lat: 50.07, lng: 19.96 },
    traffic_density_multiplier: 1,
    enable_cascade_mode: enableCascadeMode,
    playback_speed: 1,
  };
}

// First sample signal arrives at 1480 / 5400 * 380 ≈ 104.1 s, so its TTI is ≤ 40 s at 65 s;
// the second (152 m further, TTI ≈ 49.8 s) is still outside its own clearing window.
const ELAPSED_WITH_FIRST_SIGNAL_CLEARING = 65;

describe("stepMockSignals", () => {
  it.each([
    [true, "CLEARING", true],
    [false, "NORMAL", false],
  ] as const)(
    "enters cascade targets within 250 m only when cascade is enabled (cascade %s)",
    (enableCascadeMode, nextState, nextIsCascade) => {
      const session = createMockSession(requestWithCascade(enableCascadeMode));
      session.elapsedSeconds = ELAPSED_WITH_FIRST_SIGNAL_CLEARING;
      const enteredClearing = new Set<number>();

      stepMockSignals(session, enteredClearing);

      expect(session.signals[0]).toMatchObject({ state: "CLEARING", isCascade: false });
      expect(session.signals[1]).toMatchObject({ state: nextState, isCascade: nextIsCascade });
      expect([...enteredClearing]).toEqual(enableCascadeMode ? [0, 1] : [0]);
    },
  );
});
