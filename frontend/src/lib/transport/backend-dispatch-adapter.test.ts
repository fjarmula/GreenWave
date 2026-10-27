import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendDispatchAdapter } from "@/lib/transport/backend-dispatch-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import type { DispatchRankResponse, Station } from "@/types/telemetry";

const BASE = "http://127.0.0.1:8000";
const OPTIONS = { timeoutMilliseconds: 10_000 };

const STATION: Station = {
  station_id: "STN-F-0001",
  vehicle_type: "FIRE_TRUCK",
  source_kind: "fire_state",
  name: "JRG 1",
  position: { lat: 50.06, lng: 19.94 },
};
const RANK: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50.0617, lng: 19.9373 }, snap_distance_m: 4.2 },
  candidates: [
    {
      station: STATION,
      greenwave_seconds: 309.4,
      standard_seconds: 372.6,
      distance_m: 3290,
      on_site: false,
    },
  ],
  station_at_incident: null,
  scenario_time: "2026-10-27T12:00:00",
  outcome: "OK",
  incident_area: null,
  excluded_teams: [],
  roster: null,
  area_rule: null,
};

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("createBackendDispatchAdapter", () => {
  const adapter = createBackendDispatchAdapter(BASE, OPTIONS);

  it("offers geocoding and road-time ranking", () => {
    expect(adapter.capabilities).toEqual({ geocode: true, roadTimeRanking: true });
  });

  it("lists validated stations from GET /api/v1/stations", async () => {
    const fetchMock = respond(200, { schema_version: "1.0", stations: [STATION] });

    await expect(adapter.listStations()).resolves.toEqual([STATION]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v1/stations`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("geocodes with an encoded query", async () => {
    const results = [
      {
        label: "Floriańska 1",
        position: { lat: 50.06, lng: 19.94 },
        provenance: "matched",
        osm_delta_m: 4,
        osm_same_key_elsewhere: false,
      },
    ];
    const fetchMock = respond(200, { schema_version: "1.0", results });

    await expect(adapter.geocode("Floriańska 1")).resolves.toEqual(results);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v1/geocode?q=Floria%C5%84ska+1`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("posts the rank request and returns the validated ranking", async () => {
    const fetchMock = respond(200, RANK);
    const request = {
      incident: { lat: 50.0617, lng: 19.9373 },
      vehicle_type: "FIRE_TRUCK" as const,
      traffic_density_multiplier: 1,
      time_mode: "ENABLED" as const,
      availability: {},
    };

    await expect(adapter.rank(request)).resolves.toEqual(RANK);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v1/dispatch/rank`,
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) }),
    );
  });

  it.each([
    ["no candidates", { ...RANK, candidates: [] }],
    ["four candidates", { ...RANK, candidates: Array(4).fill(RANK.candidates[0]) }],
    [
      "an unknown vehicle type",
      { ...RANK, station_at_incident: { ...STATION, vehicle_type: "TANK" } },
    ],
    ["a missing time", { ...RANK, candidates: [{ station: STATION, distance_m: 1 }] }],
  ])("rejects a ranking with %s", async (_name, body) => {
    respond(200, body);
    const error = await adapter
      .rank({
        incident: { lat: 50, lng: 19.9 },
        vehicle_type: "FIRE_TRUCK",
        traffic_density_multiplier: 1,
        time_mode: "ENABLED",
        availability: {},
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SimulationAdapterError);
    expect(error.kind).toBe("http");
  });

  it.each(["DESTINATION_OFF_NETWORK", "NO_STATION_REACHABLE"] as const)(
    "maps a 422 %s to its error code",
    async (code) => {
      respond(422, { schema_version: "1.0", error_code: code, message: "nope" });
      const error = await adapter
        .rank({
          incident: { lat: 50, lng: 19.9 },
          vehicle_type: "AMBULANCE",
          traffic_density_multiplier: 1,
          time_mode: "ENABLED",
          availability: {},
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(SimulationAdapterError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(422);
    },
  );

  it("reports an unreachable backend as a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = await adapter.listStations().catch((e) => e);
    expect(error).toBeInstanceOf(SimulationAdapterError);
    expect(error.kind).toBe("network");
  });

  it("rejects an aborted request with an abort error, not a domain error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      ),
    );
    const controller = new AbortController();
    const pending = adapter.geocode("Floriańska", controller.signal).catch((e) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(SimulationAdapterError);
    expect(error.name).toBe("AbortError");
  });
});

it("captures the full wire envelope and error JSON without changing validation", async () => {
  const { diagnosticStore } = await import("@/lib/diagnostics/store");
  diagnosticStore.clear();
  const response = { schema_version: "1.0", stations: [STATION], extra: "wire field" };
  const text = JSON.stringify(response, null, 1);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status: 200 })),
  );
  const adapter = createBackendDispatchAdapter(BASE, OPTIONS);
  await expect(adapter.listStations()).resolves.toEqual([STATION]);
  expect(diagnosticStore.getSnapshot().at(-1)).toMatchObject({
    capture: { method: "GET", path: "/api/v1/stations", status: 200, responseBody: text },
  });
  respond(422, { detail: [{ msg: "invalid destination" }] });
  const request = {
    incident: { lat: 50.06, lng: 19.94 },
    vehicle_type: "FIRE_TRUCK" as const,
    traffic_density_multiplier: 1,
    time_mode: "ENABLED" as const,
    availability: {},
  };
  await expect(adapter.rank(request)).rejects.toBeInstanceOf(SimulationAdapterError);
  expect(diagnosticStore.getSnapshot().at(-1)).toMatchObject({
    outcome: "failure",
    capture: {
      requestBody: JSON.stringify(request),
      responseBody: JSON.stringify({ detail: [{ msg: "invalid destination" }] }),
      status: 422,
    },
  });
});

it("labels an HTTP 200 body rejected by validation as a failure with its original payload", async () => {
  const { diagnosticStore } = await import("@/lib/diagnostics/store");
  diagnosticStore.clear();
  respond(200, { schema_version: "1.0", stations: "invalid" });
  await expect(createBackendDispatchAdapter(BASE, OPTIONS).listStations()).rejects.toBeInstanceOf(
    SimulationAdapterError,
  );
  expect(diagnosticStore.getSnapshot().at(-1)).toMatchObject({
    outcome: "failure",
    capture: {
      status: 200,
      validation: "rejected",
      responseBody: JSON.stringify({ schema_version: "1.0", stations: "invalid" }),
    },
  });
});
