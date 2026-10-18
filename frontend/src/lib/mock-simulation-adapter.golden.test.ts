import { afterEach, expect, it, vi } from "vitest";
import { DESTINATION_ENDPOINTS, ORIGIN_ENDPOINTS } from "@/components/map/dispatch-endpoints";
import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import { MOCK_STREAM_INTERVAL_MILLISECONDS } from "@/lib/mock-simulation-config";
import type { SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import type { SimulationStartRequest } from "@/types/telemetry";

const SCENARIOS = [
  { cascade: true, playback: 1 },
  { cascade: false, playback: 1 },
  { cascade: true, playback: 5 },
] as const;

const MAX_INTERVALS = 10_000;

afterEach(() => vi.useRealTimers());

it("mock stream matches the recorded event sequence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
  const [originLng, originLat] = ORIGIN_ENDPOINTS[0].coordinates;
  const [destinationLng, destinationLat] = DESTINATION_ENDPOINTS[0].coordinates;
  const records: Array<{ scenario: number; callback: string; payload: unknown }> = [];

  for (const [index, scenario] of SCENARIOS.entries()) {
    const adapter = createMockSimulationAdapter();
    const request: SimulationStartRequest = {
      simulation_id: `SIM-golden-${index}`,
      origin: { lng: originLng, lat: originLat },
      destination: { lng: destinationLng, lat: destinationLat },
      traffic_density_multiplier: 1.5,
      enable_cascade_mode: scenario.cascade,
      playback_speed: scenario.playback,
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
    for (let interval = 0; !terminal; interval += 1) {
      if (interval >= MAX_INTERVALS) throw new Error(`scenario ${index} never terminated`);
      vi.advanceTimersByTime(MOCK_STREAM_INTERVAL_MILLISECONDS);
    }
  }

  await expect(JSON.stringify(records, null, 1)).toMatchFileSnapshot(
    "./__snapshots__/mock-stream.json",
  );
});
