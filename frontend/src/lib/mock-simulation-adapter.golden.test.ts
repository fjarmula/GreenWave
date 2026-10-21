import { afterEach, expect, it, vi } from "vitest";
import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import { MOCK_STREAM_INTERVAL_MILLISECONDS } from "@/lib/mock-simulation-config";
import type { SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import type { SimulationStartRequest } from "@/types/telemetry";

type Scenario = {
  cascade: boolean;
  playback: 1 | 5;
  // Stopped runs call stop() after this many intervals instead of running to completion.
  stopAfterIntervals?: number;
};

const SCENARIOS: readonly Scenario[] = [
  { cascade: true, playback: 1 },
  { cascade: false, playback: 1 },
  { cascade: true, playback: 5 },
  { cascade: true, playback: 1, stopAfterIntervals: 2 },
];

const MAX_INTERVALS = 10_000;
const POST_STOP_INTERVALS = 5;

afterEach(() => vi.useRealTimers());

it("mock stream matches the recorded event sequence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
  // The former default endpoints (University Hospital → Łazarza), kept so the recording holds.
  const [originLng, originLat] = [19.955, 50.015];
  const [destinationLng, destinationLat] = [19.96, 50.063];
  const records: Array<{ scenario: number; callback: string; payload: unknown }> = [];

  for (const [index, scenario] of SCENARIOS.entries()) {
    const adapter = createMockSimulationAdapter();
    const request: SimulationStartRequest = {
      green_wave_mode: "ENABLED",
      simulation_id: `SIM-golden-${index}`,
      origin: { lng: originLng, lat: originLat },
      destination: { lng: destinationLng, lat: destinationLat },
      traffic_density_multiplier: 1.5,
      enable_cascade_mode: scenario.cascade,
      playback_speed: scenario.playback,
      vehicle_type: "AMBULANCE",
    };
    let terminal = false;
    const record = (callback: string) => (payload: unknown) => {
      records.push({ scenario: index, callback, payload });
    };
    const subscriber: SimulationStreamSubscriber = {
      onTick: record("onTick"),
      onItsDispatch: record("onItsDispatch"),
      onTerminal: (event) => {
        terminal = true;
        record("onTerminal")(event);
      },
      onConnectionChange: record("onConnectionChange"),
      onError: record("onError"),
    };

    records.push({ scenario: index, callback: "start", payload: await adapter.start(request) });
    adapter.subscribe(request.simulation_id, subscriber);
    if (scenario.stopAfterIntervals !== undefined) {
      vi.advanceTimersByTime(scenario.stopAfterIntervals * MOCK_STREAM_INTERVAL_MILLISECONDS);
      await adapter.stop(request.simulation_id);
      const recordedAtStop = records.length;
      vi.advanceTimersByTime(POST_STOP_INTERVALS * MOCK_STREAM_INTERVAL_MILLISECONDS);
      expect(records.length).toBe(recordedAtStop);
      const terminals = records.filter(
        (entry) => entry.scenario === index && entry.callback === "onTerminal",
      );
      expect(terminals).toHaveLength(1);
      expect(terminals[0].payload).toMatchObject({
        event_type: "SIMULATION_CANCELLED",
        reason: "STOPPED",
      });
      expect(records.at(-1)).toBe(terminals[0]);
      continue;
    }
    for (let interval = 0; !terminal; interval += 1) {
      if (interval >= MAX_INTERVALS) throw new Error(`scenario ${index} never terminated`);
      vi.advanceTimersByTime(MOCK_STREAM_INTERVAL_MILLISECONDS);
    }
  }

  // Trailing newline keeps the golden file stable under the end-of-file-fixer hook.
  await expect(`${JSON.stringify(records, null, 1)}\n`).toMatchFileSnapshot(
    "./__snapshots__/mock-stream.json",
  );
});
