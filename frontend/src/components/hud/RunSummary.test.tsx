import { renderToStaticMarkup } from "@/test-utils/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunSummary } from "@/components/hud/RunSummary";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));

function render() {
  return renderToStaticMarkup(
    <RunSummary onBackToSetup={() => undefined} onStop={() => undefined} />,
  );
}

function stopButton(markup: string): string | undefined {
  return markup.match(/<button[^>]*data-testid="stop-simulation"[^>]*>.*?<\/button>/)?.[0];
}

describe("RunSummary live controls", () => {
  beforeEach(() => {
    state = initialSimulationState;
  });

  it("offers Stop, and no way back to setup, while the run is live", () => {
    state = { ...initialSimulationState, simulationState: "RUNNING" };
    const markup = render();

    const button = stopButton(markup);
    expect(button).toContain("Stop simulation");
    expect(button).not.toContain(' disabled=""');
    expect(markup).not.toContain("Back to dispatch setup");
  });

  it("leaves the phone Stop to the KPI strip, which stays on screen", () => {
    state = { ...initialSimulationState, simulationState: "RUNNING" };
    const button = stopButton(render());

    expect(button).toMatch(/class="[^"]*\bhidden\b[^"]*\blg:flex\b/);
  });

  it("shows the stop in progress", () => {
    state = { ...initialSimulationState, simulationState: "RUNNING", stopRequested: true };
    const button = stopButton(render());

    expect(button).toContain("Stopping…");
    expect(button).toContain(' disabled=""');
    expect(button).toContain('aria-busy="true"');
  });

  it("reports a failed stop while the run keeps going", () => {
    state = {
      ...initialSimulationState,
      simulationState: "RUNNING",
      stopError: "Simulation backend unreachable",
    };
    const markup = render();

    expect(markup).toMatch(
      /role="alert"[^>]*>.*Could not stop the simulation: Simulation backend unreachable/,
    );
    expect(stopButton(markup)).toContain("Stop simulation");
  });

  it("after a stop, says so and offers the way back to dispatch setup", () => {
    state = { ...initialSimulationState, simulationState: "CANCELLED", cancelReason: "STOPPED" };
    const markup = render();

    expect(markup).toContain("Simulation stopped");
    expect(markup).toContain("Back to dispatch setup");
    expect(stopButton(markup)).toBeUndefined();
  });

  it("keeps the supersession explanation", () => {
    state = { ...initialSimulationState, simulationState: "CANCELLED", cancelReason: "SUPERSEDED" };
    const markup = render();

    expect(markup).toContain("Superseded by another dispatch");
    expect(markup).toContain("Back to dispatch setup");
  });

  it("reports a server-side run failure as an error with the way back to setup", () => {
    state = {
      ...initialSimulationState,
      simulationState: "CANCELLED",
      cancelReason: "SERVER_ERROR",
    };
    const markup = render();

    expect(markup).toMatch(
      /<section role="alert"[^>]*>.*<h2[^>]*>Simulation server error\. Retry the green corridor initialization\.<\/h2>/,
    );
    expect(markup).toContain("Back to dispatch setup");
    expect(markup).not.toContain("Simulation cancelled");
    expect(markup).not.toContain("Another dispatch started");
  });

  it("renders nothing before a run exists", () => {
    expect(render()).toBe("");
  });
});
