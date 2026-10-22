import { expect, it } from "vitest";
import { selectReplayFrame, advanceReplay, completionDelta } from "./replay";
import { createRecording } from "./recording";
import { request, route, tick, completed } from "./fixtures.test-support";
function run(n: number) {
  const r = createRecording(request, route());
  for (let i = 1; i <= n; i++) {
    const t = tick(i);
    t.ambulance = {
      ...t.ambulance,
      position: { lng: 19.9571, lat: 50.0612 },
      status: i >= 2 ? "ARRIVED" : "EN_ROUTE",
    };
    r.tick(t);
  }
  return r.finish(completed(n));
}
it("selects by simulated seconds and clamps the cursor", () => {
  const r = run(3);
  expect(selectReplayFrame(r, 1.5).liveTelemetry?.tick).toBe(1);
  expect(selectReplayFrame(r, 99).simulationState).toBe("FINISHED");
  expect(selectReplayFrame(r, -1).liveTelemetry?.ambulance.position).toEqual(request.origin);
  expect(selectReplayFrame(r, 2).liveTelemetry?.ambulance.status).toBe("ARRIVED");
  expect(completionDelta({ enabled: run(2), disabled: run(3) })).toBe(1);
});
it("freezes when paused or hidden and clamps replay end", () => {
  expect(advanceReplay(4, 2, true, false, 10)).toBe(4);
  expect(advanceReplay(4, 2, false, true, 10)).toBe(4);
  expect(advanceReplay(4, 20, true, true, 10)).toBe(10);
});
it("does not claim a faster mode when recorded travel times are equal", async () => {
  const { comparisonResultLabel } = await import("./replay");
  expect(comparisonResultLabel(0)).toBe("same travel time");
  expect(comparisonResultLabel(3)).toBe("Green Wave faster");
  expect(comparisonResultLabel(-2)).toBe("standard traffic faster");
});
it("advances both replay panes by the chosen simulated playback speed", () => {
  expect(advanceReplay(3, 0.5, true, true, 20, 2)).toBe(4);
  expect(advanceReplay(3, 0.5, false, true, 20, 10)).toBe(3);
  expect(advanceReplay(19, 0.5, true, true, 20, 10)).toBe(20);
});
