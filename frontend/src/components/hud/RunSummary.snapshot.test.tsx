import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinishedRunSummary } from "@/components/hud/RunSummary";
import type { GreenWaveMode, SimulationCompletedEvent } from "@/types/telemetry";

const COMPLETION: SimulationCompletedEvent = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "SIMULATION_COMPLETED",
  simulation_id: "SIM-summary",
  tick: 520,
  timestamp: "2026-10-21T00:08:40Z",
  kpi_metrics: { current_time_saved_sec: 260, total_time_elapsed_sec: 520 },
};

function render(mode: GreenWaveMode) {
  return renderToStaticMarkup(
    <FinishedRunSummary
      route={{
        estimated_normal_time_sec: 780,
        estimated_greenwave_time_sec: 380,
        green_wave_mode: mode,
      }}
      completion={COMPLETION}
      onBackToSetup={() => undefined}
    />,
  );
}

describe.each(["ENABLED", "DISABLED"] as const)("FinishedRunSummary (%s)", (mode) => {
  it("matches the recorded markup", async () => {
    await expect(`${render(mode)}\n`).toMatchFileSnapshot(
      `./__snapshots__/RunSummary.${mode.toLowerCase()}.html`,
    );
  });

  it("leads with the total travel time and states the mode", () => {
    const markup = render(mode);

    expect(markup.match(/<dt[^>]*>([^<]*)<\/dt>/)?.[1]).toBe("Total travel time");
    expect(markup).toContain("08m 40s");
    expect(markup).toContain(mode === "ENABLED" ? "Enabled" : "Disabled");
  });
});
