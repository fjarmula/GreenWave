import { describe, expect, it } from "vitest";

import { buildStartRequest, DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import { candidateTotalSeconds, runnerUpIds } from "@/lib/station-choice";
import { selectedCandidate } from "@/lib/useIncidentDispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

const candidate = (stationId: string, lat: number): RankedCandidate => ({
  station: {
    station_id: stationId,
    vehicle_type: "AMBULANCE",
    source_kind: "ambulance_base",
    name: stationId,
    position: { lat, lng: 19.9 },
  },
  greenwave_seconds: 100 * lat,
  standard_seconds: 100 * lat + 60,
  distance_m: 900,
});

const ranking: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50, lng: 19.9 }, snap_distance_m: 1 },
  candidates: [candidate("A", 50.01), candidate("B", 50.02), candidate("C", 50.03)],
  station_at_incident: null,
};

describe("runnerUpIds", () => {
  it("lists every candidate but the selected one, in ranking order", () => {
    expect(runnerUpIds(ranking, null)).toEqual(["B", "C"]);
    expect(runnerUpIds(ranking, "B")).toEqual(["A", "C"]);
    expect(runnerUpIds(ranking, "gone")).toEqual(["B", "C"]);
    expect(runnerUpIds(null, null)).toEqual([]);
  });
});

it("starts the run from the selected station", () => {
  const selected = selectedCandidate({ ranking, selectedStationId: "B" });
  const request = buildStartRequest(
    selected!.station,
    { position: { lat: 50.06, lng: 19.94 }, label: "Pinned", source: "map" },
    "AMBULANCE",
    DEFAULT_DISPATCH_SETTINGS,
    "SIM-1",
  );

  expect(request.origin).toEqual({ lat: 50.02, lng: 19.9 });
});

describe("candidateTotalSeconds", () => {
  it("adds the walk to the drive", () => {
    const leg = { access_point: { lat: 50, lng: 19.9 }, distance_m: 650, seconds: 464 };
    expect(candidateTotalSeconds({ ...candidate("A", 50.01), greenwave_seconds: 140 })).toBe(140);
    expect(
      candidateTotalSeconds({ ...candidate("A", 50.01), greenwave_seconds: 140, on_foot: leg }),
    ).toBe(604);
  });
});
