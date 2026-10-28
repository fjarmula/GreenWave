import { describe, expect, it, vi } from "vitest";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { createMockDispatchAdapter } from "@/lib/mock-dispatch";
import {
  loadStations,
  STATIONS_RETRY_DELAYS_MS,
  STATIONS_UNAVAILABLE,
  watchStations,
  type StationsState,
} from "@/lib/useStations";
import type { Station } from "@/types/telemetry";

const STATION: Station = {
  station_id: "STN-A-0001",
  vehicle_type: "AMBULANCE",
  source_kind: "prm_base",
  name: "KPR",
  position: { lat: 50.06, lng: 19.94 },
};

const adapterWith = (listStations: DispatchAdapter["listStations"]) =>
  ({ listStations }) as DispatchAdapter;

describe("loadStations", () => {
  it("returns the loaded stations without an error", async () => {
    expect(await loadStations(adapterWith(async () => [STATION]))).toEqual({
      stations: [STATION],
      error: null,
    });
  });

  it("reports a failed load instead of only logging it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await loadStations(
      adapterWith(async () => {
        throw new Error("HTTP 503");
      }),
    );

    expect(result).toEqual({ stations: [], error: STATIONS_UNAVAILABLE });
    expect(STATIONS_UNAVAILABLE).toBe("Station list unavailable — check the backend");
  });

  it("never errors in mock mode", async () => {
    const result = await loadStations(createMockDispatchAdapter());

    expect(result.error).toBeNull();
    expect(result.stations.length).toBeGreaterThan(0);
  });
});

describe("watchStations", () => {
  const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  it("retries after failures and stops once the stations arrive", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listStations = vi
      .fn<DispatchAdapter["listStations"]>()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue([STATION]);
    const states: StationsState[] = [];

    watchStations(adapterWith(listStations), (state) => states.push(state));
    await settle();
    expect(states.at(-1)).toEqual({ stations: [], error: STATIONS_UNAVAILABLE });
    await settle(STATIONS_RETRY_DELAYS_MS[0]);
    await settle(STATIONS_RETRY_DELAYS_MS[1]);
    expect(states.at(-1)).toEqual({ stations: [STATION], error: null });

    await settle(60_000);
    expect(listStations).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("makes no further calls once stopped (unmount)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listStations = vi.fn<DispatchAdapter["listStations"]>().mockRejectedValue(new Error("x"));
    const states: StationsState[] = [];

    const stop = watchStations(adapterWith(listStations), (state) => states.push(state));
    await settle();
    stop();
    await settle(120_000);

    expect(listStations).toHaveBeenCalledTimes(1);
    expect(states).toHaveLength(1);
    vi.useRealTimers();
  });
});
