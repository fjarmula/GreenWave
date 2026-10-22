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
