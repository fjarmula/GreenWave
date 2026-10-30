import { describe, expect, it } from "vitest";

import { buildStartRequest, DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import {
  candidateDriveSeconds,
  candidateTotalSeconds,
  fastestCandidateId,
  rankTimeModeFor,
  isOnSite,
  onSiteResult,
  orderCandidates,
  pageCandidate,
  shownOnSite,
  runnerUpIds,
  timeModeFor,
} from "@/lib/station-choice";
import { TEAM_RANK } from "@/lib/transport/__fixtures__/team-dispatch";
import type { DispatchRankResponse, RankedCandidate } from "@/types/telemetry";

const candidate = (stationId: string, lat: number): RankedCandidate => ({
  station: {
    station_id: stationId,
    vehicle_type: "AMBULANCE",
    source_kind: "prm_base",
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
  scenario_time: "2026-10-27T12:00:00",
  outcome: "OK",
  incident_area: null,
  excluded_teams: [],
  roster: null,
  area_rule: null,
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
  const selected = pageCandidate({ ranking, selectedStationId: "B" }, "BOTH");
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

describe("on-site dispatch", () => {
  const walk = { access_point: { lat: 50.01, lng: 19.9 }, distance_m: 120, seconds: 111 };
  const onSite = { ...candidate("A", 50.01), on_site: true, on_foot: walk };
  const here = { position: { lat: 50.01, lng: 19.9 }, label: "Pinned", source: "map" as const };

  it("recognises an on-site candidate", () => {
    expect(isOnSite(onSite)).toBe(true);
    expect(isOnSite(candidate("B", 50.02))).toBe(false);
    expect(isOnSite(null)).toBe(false);
  });

  it("starts an on-site result instead of a run", () => {
    expect(onSiteResult(onSite, here, "AMBULANCE")).toEqual({
      station: onSite.station,
      walk,
      incident: here,
      vehicleType: "AMBULANCE",
    });
    expect(onSiteResult(candidate("B", 50.02), here, "AMBULANCE")).toBeNull();
    expect(onSiteResult(onSite, null, "AMBULANCE")).toBeNull();
  });

  it("drops the result once the incident or vehicle changes", () => {
    const result = onSiteResult(onSite, here, "AMBULANCE");
    expect(shownOnSite(result, { incident: here, vehicleType: "AMBULANCE" })).toBe(result);
    expect(shownOnSite(result, { incident: { ...here }, vehicleType: "AMBULANCE" })).toBeNull();
    expect(shownOnSite(result, { incident: here, vehicleType: "FIRE_TRUCK" })).toBeNull();
    expect(shownOnSite(null, { incident: here, vehicleType: "AMBULANCE" })).toBeNull();
  });
});

describe("team-ranked ambulance candidates (ADR 0014)", () => {
  it("test keeps backend order for team ranking", () => {
    for (const mode of ["GREENWAVE", "STANDARD", "BOTH"] as const) {
      expect(orderCandidates(TEAM_RANK.candidates, mode).map((c) => c.team?.team_code)).toEqual([
        "K01 008",
        "K01 001",
      ]);
    }
  });

  it("test page candidate defaults to the recommended team", () => {
    const ranking = TEAM_RANK;
    expect(pageCandidate({ ranking, selectedStationId: null }, "GREENWAVE")?.team?.team_code).toBe(
      "K01 008",
    );
  });

  it("test fastest chip on a later row", () => {
    expect(fastestCandidateId(TEAM_RANK.candidates, "GREENWAVE")).toBe("STN-A-0007");
    expect(fastestCandidateId(TEAM_RANK.candidates, "STANDARD")).toBe("STN-A-0007");
    expect(fastestCandidateId([], "GREENWAVE")).toBeNull();
  });

  it("test re-sorts fire candidates as before", () => {
    const fire = TEAM_RANK.candidates.map((c) => ({ ...c, team: null, selection_reason: null }));
    expect(orderCandidates(fire, "GREENWAVE").map((c) => c.station.station_id)).toEqual([
      "STN-A-0007",
      "STN-A-0003",
    ]);
  });
});

describe("rankTimeModeFor", () => {
  it("compares the page's own estimate, green wave on the comparison", () => {
    expect(rankTimeModeFor("ENABLED", "simulation")).toBe("ENABLED");
    expect(rankTimeModeFor("DISABLED", "simulation")).toBe("DISABLED");
    expect(rankTimeModeFor("DISABLED", "comparison")).toBe("ENABLED");
  });
});

it("previews only the ready, selected candidate using the page's start criteria", async () => {
  const { plannedRoute } = await import("./station-choice");
  const { TEAM_RANK } = await import("./transport/__fixtures__/team-dispatch");
  const geometry = {
    type: "LineString" as const,
    coordinates: [
      [19.9, 50],
      [19.94, 50.06],
    ] as [number, number][],
  };
  const ranking = {
    ...TEAM_RANK,
    candidates: TEAM_RANK.candidates.map((c, i) => ({
      ...c,
      route_geometry: {
        ...geometry,
        coordinates: [
          [19.9 + i / 100, 50],
          [19.94, 50.06],
        ] as [number, number][],
      },
    })),
  };
  const ready = { rankStatus: "ready" as const, ranking, selectedStationId: null };
  expect(plannedRoute(ready, "GREENWAVE")).toEqual(ranking.candidates[0].route_geometry);
  expect(plannedRoute(ready, "STANDARD")).toEqual(ranking.candidates[0].route_geometry);
  expect(
    plannedRoute(
      { ...ready, selectedStationId: ranking.candidates[1].station.station_id },
      "STANDARD",
    ),
  ).toEqual(ranking.candidates[1].route_geometry);
  for (const rankStatus of ["idle", "loading", "error"] as const)
    expect(plannedRoute({ ...ready, rankStatus }, "GREENWAVE")).toBeNull();
  expect(
    plannedRoute({ ...ready, ranking: { ...ranking, candidates: [] } }, "GREENWAVE"),
  ).toBeNull();
  expect(
    plannedRoute(
      {
        ...ready,
        ranking: { ...ranking, candidates: [{ ...ranking.candidates[0], on_site: true }] },
      },
      "GREENWAVE",
    ),
  ).toBeNull();
});
