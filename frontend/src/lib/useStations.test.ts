import { describe, expect, it, vi } from "vitest";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { createMockDispatchAdapter } from "@/lib/mock-dispatch";
import { loadStations, STATIONS_UNAVAILABLE } from "@/lib/useStations";
import type { Station } from "@/types/telemetry";

const STATION: Station = {
  station_id: "STN-A-0001",
  vehicle_type: "AMBULANCE",
  source_kind: "ambulance_base",
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
