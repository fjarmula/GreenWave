import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import {
  initialSimulationState,
  type SimulationPhase,
  type SimulationState,
} from "@/lib/simulation-state";
import type { CancelReason } from "@/types/telemetry";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));
vi.mock("@/components/hud/ThemeToggle", () => ({ ThemeToggle: () => null }));

describe("DashboardHeader", () => {
  beforeEach(() => {
    state = initialSimulationState;
  });

  it.each([
    ["setup", "Dispatch setup", "Live operations"],
    ["live", "Live operations", "Dispatch setup"],
  ] as const)("names the %s view without offering a switch", (mode, shown, hidden) => {
    const markup = renderToStaticMarkup(<DashboardHeader mode={mode} />);

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('aria-label="Dashboard mode"');
    expect(markup).toContain(shown);
    expect(markup).not.toContain(hidden);
  });

  it.each([
    ["SETUP", null, "System ready", "bg-go"],
    ["STARTING", null, "Computing route", "bg-caution"],
    ["RUNNING", null, "Simulation running", "bg-go"],
    ["FINISHED", null, "Simulation finished", "bg-muted-foreground"],
    ["CANCELLED", "SUPERSEDED", "Simulation cancelled", "bg-caution"],
    ["CANCELLED", "STOPPED", "Simulation stopped", "bg-muted-foreground"],
    ["CANCELLED", "SERVER_ERROR", "Simulation server error", "bg-emergency"],
    ["ERROR", null, "Simulation error", "bg-emergency"],
  ] as const)("%s (%s) reads %s with a matching dot", (phase, reason, label, dot) => {
    state = {
      ...initialSimulationState,
      simulationState: phase as SimulationPhase,
      cancelReason: reason as CancelReason | null,
    };
    const markup = renderToStaticMarkup(<DashboardHeader mode="live" />);
    const status = markup.match(/<span class="(size-2 rounded-full[^"]*)"><\/span><span>([^<]*)</)!;

    expect(status[2]).toBe(label);
    expect(status[1].split(" ")).toContain(dot);
    if (dot !== "bg-go") expect(status[1]).not.toContain("bg-go");
  });
});
