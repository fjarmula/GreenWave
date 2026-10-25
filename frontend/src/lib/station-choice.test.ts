import { describe, expect, it } from "vitest";

import { buildStartRequest, DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import {
  candidateDriveSeconds,
  candidateTotalSeconds,
  orderCandidates,
  pageCandidate,
  runnerUpIds,
  timeModeFor,
} from "@/lib/station-choice";
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
  on_site: false,
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
  const leg = { access_point: { lat: 50, lng: 19.9 }, distance_m: 650, seconds: 464 };
  const offRoad = { ...candidate("A", 50.01), greenwave_seconds: 140, standard_seconds: 200 };

  it("adds the walk to the drive", () => {
    expect(candidateTotalSeconds(offRoad, "GREENWAVE")).toBe(140);
    expect(candidateTotalSeconds({ ...offRoad, on_foot: leg }, "GREENWAVE")).toBe(604);
  });

  it("uses the drive of the page's mode", () => {
    expect(candidateDriveSeconds(offRoad, "GREENWAVE")).toBe(140);
    expect(candidateDriveSeconds(offRoad, "STANDARD")).toBe(200);
    expect(candidateTotalSeconds({ ...offRoad, on_foot: leg }, "STANDARD")).toBe(664);
  });
});

describe("pageCandidate", () => {
  const fast = { ...candidate("A", 50.01), greenwave_seconds: 100, standard_seconds: 300 };
  const slow = { ...candidate("B", 50.02), greenwave_seconds: 150, standard_seconds: 200 };
  const twoModes: DispatchRankResponse = { ...ranking, candidates: [fast, slow] };

  it("defaults to the page mode's fastest", () => {
    const pick = (mode: "GREENWAVE" | "STANDARD" | "BOTH") =>
      pageCandidate({ ranking: twoModes, selectedStationId: null }, mode)?.station.station_id;
    expect(pick("STANDARD")).toBe("B");
    expect(pick("GREENWAVE")).toBe("A");
    expect(pick("BOTH")).toBe("A");
  });

  it("keeps an explicit pick and ignores an unknown one", () => {
    expect(
      pageCandidate({ ranking: twoModes, selectedStationId: "A" }, "STANDARD")?.station.station_id,
    ).toBe("A");
    expect(
      pageCandidate({ ranking: twoModes, selectedStationId: "gone" }, "STANDARD")?.station
        .station_id,
    ).toBe("B");
    expect(pageCandidate({ ranking: null, selectedStationId: null }, "STANDARD")).toBeNull();
  });

  it("leaves the page pick out of the runners-up", () => {
    expect(runnerUpIds(twoModes, null, "STANDARD")).toEqual(["A"]);
    expect(runnerUpIds(twoModes, null, "GREENWAVE")).toEqual(["B"]);
  });

  it("maps a page to its time mode", () => {
    expect(timeModeFor("DISABLED", "simulation")).toBe("STANDARD");
    expect(timeModeFor("ENABLED", "simulation")).toBe("GREENWAVE");
    expect(timeModeFor("DISABLED", "comparison")).toBe("BOTH");
  });
});

describe("orderCandidates", () => {
  const a = { ...candidate("A", 50.01), greenwave_seconds: 100, standard_seconds: 300 };
  const b = { ...candidate("B", 50.02), greenwave_seconds: 150, standard_seconds: 200 };
  const c = { ...candidate("C", 50.03), greenwave_seconds: 200, standard_seconds: 200 };

  it("orders by the mode's total and keeps ties stable", () => {
    expect(orderCandidates([a, b, c], "STANDARD").map((x) => x.station.station_id)).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(orderCandidates([c, b, a], "GREENWAVE").map((x) => x.station.station_id)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("keeps the backend order for the comparison page", () => {
    expect(orderCandidates([c, a, b], "BOTH").map((x) => x.station.station_id)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });
});
