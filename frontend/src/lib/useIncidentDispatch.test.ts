import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import {
  createIncidentDispatch,
  DENSITY_RERANK_DELAY_MS,
  describeRankError,
  pinnedIncident,
  selectedCandidate,
  type Incident,
} from "@/lib/useIncidentDispatch";
import { RESOURCES } from "@/lib/transport/__fixtures__/team-dispatch";
import type { DispatchRankRequest, DispatchRankResponse } from "@/types/telemetry";

type Pending = {
  request: DispatchRankRequest;
  signal?: AbortSignal;
  resolve: (value: DispatchRankResponse) => void;
  reject: (error: unknown) => void;
};

/** An adapter whose rank calls stay pending until the test settles them; it ignores aborts. */
function deferredAdapter(resources = true) {
  const calls: Pending[] = [];
  const resourceCalls: string[] = [];
  const adapter: DispatchAdapter = {
    capabilities: { geocode: true, roadTimeRanking: true, resources },
    listStations: async () => [],
    listResources: async (at) => {
      resourceCalls.push(at);
      return { ...RESOURCES, at: `${at}:00` };
    },
    geocode: async () => [],
    rank: (request, signal) =>
      new Promise((resolve, reject) => calls.push({ request, signal, resolve, reject })),
  };
  return { adapter, calls, resourceCalls };
}

/** Tuesday 27 October 2026, 21:03 local time. */
const NOW = () => new Date(2026, 9, 27, 21, 3, 30);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const incident = (lat: number): Incident => ({
  position: { lat, lng: 19.94 },
  label: `Pinned ${lat}`,
  source: "map",
});

const ranking = (stationId: string): DispatchRankResponse => ({
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50, lng: 19.9 }, snap_distance_m: 1 },
  candidates: [
    {
      station: {
        station_id: stationId,
        vehicle_type: "AMBULANCE",
        source_kind: "ambulance_base",
        name: stationId,
        position: { lat: 50, lng: 19.9 },
      },
      greenwave_seconds: 120,
      standard_seconds: 150,
      distance_m: 900,
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
});

const candidate = (stationId: string, seconds: number) => ({
  station: {
    station_id: stationId,
    vehicle_type: "AMBULANCE" as const,
    source_kind: "ambulance_base" as const,
    name: stationId,
    position: { lat: 50, lng: 19.9 },
  },
  greenwave_seconds: seconds,
  standard_seconds: seconds + 30,
  distance_m: 900,
  on_site: false,
});

const threeStations: DispatchRankResponse = {
  ...ranking("A"),
  candidates: [candidate("A", 120), candidate("B", 150), candidate("C", 200)],
};

describe("createIncidentDispatch", () => {
  it("starts idle with an ambulance and no incident, without ranking", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    expect(dispatch.getState()).toMatchObject({
      vehicleType: "AMBULANCE",
      incident: null,
      ranking: null,
      rankStatus: "idle",
      rankError: null,
    });
    expect(calls).toHaveLength(0);
  });

  it("ranks when an incident is set", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);

    dispatch.setIncident(incident(50.01));
    expect(dispatch.getState().rankStatus).toBe("loading");
    calls[0].resolve(ranking("STN-A-0001"));
    await flush();

    expect(calls[0].request).toEqual({
      incident: { lat: 50.01, lng: 19.94 },
      vehicle_type: "AMBULANCE",
      traffic_density_multiplier: 1,
      scenario_time: "2026-10-27T21:00",
      time_mode: "ENABLED",
      availability: {},
    });
    expect(dispatch.getState().rankStatus).toBe("ready");
    expect(dispatch.getState().ranking?.candidates[0].station.station_id).toBe("STN-A-0001");
  });

  it("test_stale_rank_discarded: an older response never overwrites a newer one", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    dispatch.setIncident(incident(50.02));
    expect(calls[0].signal?.aborted).toBe(true);
    calls[1].resolve(ranking("STN-A-0002"));
    await flush();
    calls[0].resolve(ranking("STN-A-0001"));
    await flush();

    expect(dispatch.getState().ranking?.candidates[0].station.station_id).toBe("STN-A-0002");
    expect(dispatch.getState().incident?.position.lat).toBe(50.02);
    expect(dispatch.getState().rankStatus).toBe("ready");
  });

  it("ignores the abort rejection of a superseded request", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    dispatch.setVehicleType("FIRE_TRUCK");
    calls[0].reject(new DOMException("aborted", "AbortError"));
    await flush();

    expect(dispatch.getState().rankStatus).toBe("loading");
    expect(dispatch.getState().rankError).toBeNull();
  });

  it("test_vehicle_type_change_reranks", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);
    dispatch.setIncident(incident(50.01));
    calls[0].resolve(ranking("STN-A-0001"));
    await flush();

    dispatch.setVehicleType("FIRE_TRUCK");

    expect(calls).toHaveLength(2);
    expect(calls[1].request.vehicle_type).toBe("FIRE_TRUCK");
    expect(dispatch.getState()).toMatchObject({
      vehicleType: "FIRE_TRUCK",
      rankStatus: "loading",
      ranking: null,
    });
  });

  it("ranks with the chosen traffic density, without ranking before an incident", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setTrafficDensity(2);
    expect(calls).toHaveLength(0);
    dispatch.setIncident(incident(50.01));

    expect(calls[0].request.traffic_density_multiplier).toBe(2);
  });

  describe("density re-rank", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

    it("re-ranks on density change and ignores the stale response", async () => {
      const { adapter, calls } = deferredAdapter();
      const dispatch = createIncidentDispatch(adapter);
      dispatch.setIncident(incident(50.01));
      calls[0].resolve(ranking("STN-A-0001"));
      await settle();

      dispatch.setTrafficDensity(2.5);
      await settle(DENSITY_RERANK_DELAY_MS);
      dispatch.setTrafficDensity(3);
      await settle(DENSITY_RERANK_DELAY_MS);
      expect(calls.map((call) => call.request.traffic_density_multiplier)).toEqual([1, 2.5, 3]);
      expect(calls[1].signal?.aborted).toBe(true);
      calls[2].resolve(ranking("STN-A-0003"));
      await settle();
      calls[1].resolve(ranking("STN-A-0002"));
      await settle();

      expect(dispatch.getState().ranking?.candidates[0].station.station_id).toBe("STN-A-0003");
      expect(dispatch.getState().trafficDensity).toBe(3);
    });

    it("ranks once for a slider drag, with the last density", async () => {
      const { adapter, calls } = deferredAdapter();
      const dispatch = createIncidentDispatch(adapter);
      dispatch.setIncident(incident(50.01));
      calls[0].resolve(ranking("STN-A-0001"));
      await settle();

      for (let tenths = 11; tenths <= 30; tenths += 1) {
        dispatch.setTrafficDensity(tenths / 10);
        await settle(16);
      }
      expect(calls).toHaveLength(1);
      await settle(DENSITY_RERANK_DELAY_MS);

      expect(calls.map((call) => call.request.traffic_density_multiplier)).toEqual([1, 3]);
      expect(dispatch.getState().trafficDensity).toBe(3);
    });

    it("keeps the dispatcher's pick through a density re-rank", async () => {
      const { adapter, calls } = deferredAdapter();
      const dispatch = createIncidentDispatch(adapter);
      dispatch.setIncident(incident(50.01));
      calls[0].resolve(threeStations);
      await settle();
      dispatch.selectStation("B");

      dispatch.setTrafficDensity(2);
      await settle(DENSITY_RERANK_DELAY_MS);
      expect(dispatch.getState().selectedStationId).toBe("B");
      calls[1].resolve(threeStations);
      await settle();

      expect(dispatch.getState().selectedStationId).toBe("B");
    });

    it("drops a pending density re-rank when the incident changes", async () => {
      const { adapter, calls } = deferredAdapter();
      const dispatch = createIncidentDispatch(adapter);
      dispatch.setIncident(incident(50.01));

      dispatch.setTrafficDensity(2);
      dispatch.setIncident(incident(50.02));
      await settle(DENSITY_RERANK_DELAY_MS);

      expect(calls.map((call) => call.request.traffic_density_multiplier)).toEqual([1, 2]);
      expect(calls[1].request.incident.lat).toBe(50.02);
    });
  });

  it("does not re-rank when the density is unchanged", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);
    dispatch.setIncident(incident(50.01));
    calls[0].resolve(ranking("STN-A-0001"));
    await flush();

    dispatch.setTrafficDensity(1);

    expect(calls).toHaveLength(1);
    expect(dispatch.getState().rankStatus).toBe("ready");
  });

  it("does not rank on a vehicle type change without an incident", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setVehicleType("POLICE_CAR");

    expect(calls).toHaveLength(0);
    expect(dispatch.getState()).toMatchObject({ vehicleType: "POLICE_CAR", rankStatus: "idle" });
  });

  it.each([
    ["DESTINATION_OFF_NETWORK", "No vehicle access within 800 m of this location"],
    ["NO_STATION_REACHABLE", "No station of this type can reach this location"],
  ] as const)("test_error_copy: %s", async (code, copy) => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].reject(new SimulationAdapterError({ kind: "http", status: 422, code, message: "x" }));
    await flush();

    expect(dispatch.getState()).toMatchObject({
      rankStatus: "error",
      rankError: copy,
      ranking: null,
    });
  });

  it("shows the transport message for other failures", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].reject(
      new SimulationAdapterError({ kind: "network", message: "Backend unreachable" }),
    );
    await flush();

    expect(dispatch.getState().rankError).toBe("Backend unreachable");
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const { adapter } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);
    const listener = vi.fn();
    const unsubscribe = dispatch.subscribe(listener);

    dispatch.setVehicleType("FIRE_TRUCK");
    unsubscribe();
    dispatch.setVehicleType("POLICE_CAR");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("selects the fastest by default", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].resolve(threeStations);
    await flush();

    expect(dispatch.getState().selectedStationId).toBeNull();
    expect(selectedCandidate(dispatch.getState())?.station.station_id).toBe("A");
  });

  it("selects another candidate", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].resolve(threeStations);
    await flush();
    dispatch.selectStation("B");

    expect(dispatch.getState().selectedStationId).toBe("B");
    expect(selectedCandidate(dispatch.getState())?.station.station_id).toBe("B");
  });

  it("ignores unknown station ids", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].resolve(threeStations);
    await flush();
    const before = dispatch.getState();
    const listener = vi.fn();
    dispatch.subscribe(listener);
    dispatch.selectStation("Z");

    expect(dispatch.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("resets selection on every re-rank", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    calls[0].resolve(threeStations);
    await flush();
    dispatch.selectStation("B");
    dispatch.setIncident(incident(50.1));
    expect(dispatch.getState().selectedStationId).toBeNull();
    calls[1].resolve(threeStations);
    await flush();
    expect(dispatch.getState().selectedStationId).toBeNull();

    dispatch.selectStation("C");
    dispatch.setVehicleType("FIRE_TRUCK");
    expect(dispatch.getState().selectedStationId).toBeNull();
    calls[2].resolve(threeStations);
    await flush();
    expect(dispatch.getState().selectedStationId).toBeNull();
  });

  it("falls back to the fastest", () => {
    expect(
      selectedCandidate({ ranking: threeStations, selectedStationId: "gone" })?.station.station_id,
    ).toBe("A");
    expect(selectedCandidate({ ranking: null, selectedStationId: null })).toBeNull();
  });

  it("dispose aborts the request in flight", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter);

    dispatch.setIncident(incident(50.01));
    dispatch.dispose();

    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe("pinnedIncident", () => {
  it("labels a map click with four decimals", () => {
    expect(pinnedIncident({ lat: 50.061449, lng: 19.93664 })).toEqual({
      position: { lat: 50.061449, lng: 19.93664 },
      label: "Pinned 50.0614, 19.9366",
      source: "map",
    });
  });
});

describe("describeRankError", () => {
  it("explains an incident beyond walking reach of any vehicle access", () => {
    const error = new SimulationAdapterError({
      kind: "http",
      status: 422,
      code: "DESTINATION_OFF_NETWORK",
      message: "Incident is farther than 800 m on foot from any vehicle access point",
    });
    expect(describeRankError(error)).toBe("No vehicle access within 800 m of this location");
  });
});

it("discards a ranking resolved after the incident was cleared even if abort is ignored", async () => {
  const { adapter, calls } = deferredAdapter();
  const dispatch = createIncidentDispatch(adapter);
  dispatch.setIncident(incident(50.01));
  dispatch.setIncident(null);
  expect(calls[0].signal?.aborted).toBe(true);
  calls[0].resolve(ranking("STN-A-0001"));
  await flush();
  expect(dispatch.getState()).toMatchObject({
    incident: null,
    ranking: null,
    rankStatus: "idle",
    selectedStationId: null,
  });
});

describe("scenario time and team availability (ADR 0014)", () => {
  it("defaults the scenario time to local now, rounded down to 5 minutes", () => {
    const dispatch = createIncidentDispatch(deferredAdapter().adapter, NOW);

    expect(dispatch.getState().scenarioTime).toBe("2026-10-27T21:00");
    expect(dispatch.getState().availability).toEqual({});
    expect(dispatch.getState().rankTimeMode).toBe("ENABLED");
  });

  it("re-ranks and re-fetches resources when the scenario time changes", async () => {
    const { adapter, calls, resourceCalls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);
    dispatch.setIncident(incident(50.01));

    dispatch.setScenarioTime("2026-10-27T10:00");
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[1].request.scenario_time).toBe("2026-10-27T10:00");
    expect(resourceCalls).toEqual(["2026-10-27T10:00"]);
    expect(dispatch.getState().resources?.at).toBe("2026-10-27T10:00:00");
  });

  it("refreshes resources on demand and skips them without the capability", async () => {
    const withRoster = deferredAdapter();
    const dispatch = createIncidentDispatch(withRoster.adapter, NOW);
    dispatch.refreshResources();
    await flush();
    expect(withRoster.resourceCalls).toEqual(["2026-10-27T21:00"]);

    const mock = deferredAdapter(false);
    const plain = createIncidentDispatch(mock.adapter, NOW);
    plain.refreshResources();
    plain.setScenarioTime("2026-10-27T10:00");
    await flush();
    expect(mock.resourceCalls).toEqual([]);
    expect(plain.getState().resources).toBeNull();
  });

  it("clears the previous shift roster when the new scenario roster cannot load", async () => {
    const { adapter } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);
    dispatch.refreshResources();
    await flush();
    expect(dispatch.getState().resources?.at).toBe("2026-10-27T21:00:00");

    adapter.listResources = async () => {
      throw new Error("backend unavailable");
    };
    dispatch.setScenarioTime("2026-10-27T10:00");

    expect(dispatch.getState().resources).toBeNull();
    await flush();
    expect(dispatch.getState().resources).toBeNull();
  });

  it("sends availability overrides and drops one set back to unknown", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);
    dispatch.setIncident(incident(50.01));

    dispatch.setTeamAvailability("K01 176", "busy");
    dispatch.setTeamAvailability("K01 008", "free");
    dispatch.setTeamAvailability("K01 176", "unknown");

    expect(calls.map((c) => c.request.availability)).toEqual([
      {},
      { "K01 176": "busy" },
      { "K01 176": "busy", "K01 008": "free" },
      { "K01 008": "free" },
    ]);
    expect(dispatch.getState().availability).toEqual({ "K01 008": "free" });
  });

  it("remembers availability without an incident and sends none for fire", () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);

    dispatch.setTeamAvailability("K01 176", "busy");
    expect(calls).toHaveLength(0);
    dispatch.setVehicleType("FIRE_TRUCK");
    dispatch.setIncident(incident(50.01));
    expect(calls[0].request.availability).toEqual({});
    dispatch.setTeamAvailability("K01 008", "busy");
    expect(calls).toHaveLength(1);
  });

  it("re-ranks on a time-mode change, keeping the pick", async () => {
    const { adapter, calls } = deferredAdapter();
    const dispatch = createIncidentDispatch(adapter, NOW);
    dispatch.setIncident(incident(50.01));
    calls[0].resolve(threeStations);
    await flush();
    dispatch.selectStation("B");

    dispatch.setRankTimeMode("DISABLED");
    dispatch.setRankTimeMode("DISABLED");
    calls[1].resolve(threeStations);
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[1].request.time_mode).toBe("DISABLED");
    expect(dispatch.getState().selectedStationId).toBe("B");
  });
});
