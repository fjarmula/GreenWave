import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ComparisonReplay } from "./ComparisonReplay";
import { createRecording } from "@/lib/comparison/recording";
import { request, route, tick, completed } from "@/lib/comparison/fixtures.test-support";
import type { SimulationState } from "@/lib/simulation-state";

vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: ({ snapshot }: { snapshot: SimulationState }) => (
    <div
      data-mode={snapshot.startRequest?.green_wave_mode}
      data-tick={snapshot.lastTick}
      data-state={snapshot.simulationState}
    />
  ),
}));

function recording(mode: "ENABLED" | "DISABLED", duration: number) {
  const recorder = createRecording({ ...request, green_wave_mode: mode }, route("pair", mode));
  for (let i = 1; i <= duration; i++) recorder.tick(tick(i));
  return recorder.finish(completed(duration));
}

it("renders both modes on the same clock and holds the completed pane at its final frame", () => {
  const html = renderToStaticMarkup(
    <ComparisonReplay
      pair={{ enabled: recording("ENABLED", 2), disabled: recording("DISABLED", 4) }}
      cursor={3}
      playing
      speed={2}
      pane="enabled"
      onPlayPause={() => {}}
      onRestart={() => {}}
      onSeek={() => {}}
      onSpeedChange={() => {}}
      onPaneChange={() => {}}
    />,
  );
  expect(html).toContain('data-mode="ENABLED" data-tick="2" data-state="FINISHED"');
  expect(html).toContain('data-mode="DISABLED" data-tick="3" data-state="RUNNING"');
  expect(html).toContain("Pause replay");
  expect(html).toContain('aria-label="Replay time"');
  expect(html).toContain('max="4"');
  expect(html).toContain('value="2" selected=""');
  expect(html).toContain("one shared clock");
});
