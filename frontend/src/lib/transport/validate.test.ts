import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelledEventExample,
  completedEventExample,
  errorResponseExample,
  itsDispatchEventExample,
  SIMULATION_ID,
  startResponseExample,
  tickEventExample,
} from "@/lib/transport/__fixtures__/architecture-examples";
import { createMockSession } from "@/lib/mock-session";
import { datasetQualityExample } from "@/lib/transport/__fixtures__/dataset-quality";
import { NO_ELIGIBLE_RANK, RESOURCES, TEAM_RANK } from "@/lib/transport/__fixtures__/team-dispatch";
import {
  parseComparisonStartResponse,
  parseErrorResponse,
  parseStartResponse,
  parseStreamEvent,
  validateDatasetQuality,
  validateGeocode,
  validateRank,
  validateResources,
} from "@/lib/transport/validate";

/** Round-trips through JSON like a real payload, then applies a mutation. */
function wire<T>(value: T, mutate: (copy: Record<string, unknown>) => void = () => undefined) {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  mutate(copy);
  return copy as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("parseStartResponse", () => {
  it("accepts the architecture §4 example", () => {
    expect(parseStartResponse(wire(startResponseExample))).toEqual(startResponseExample);
  });

  it("accepts the frontend mock start response", () => {
    const route = createMockSession({
      green_wave_mode: "ENABLED",
      its_scenario: "NOMINAL" as const,
      simulation_id: "validation-mock",
      origin: { lat: 50.0612, lng: 19.9571 },
      destination: { lat: 50.0134, lng: 19.9982 },
      traffic_density_multiplier: 1.5,
      enable_cascade_mode: true,
      playback_speed: 1,
      vehicle_type: "AMBULANCE",
    }).route;

    expect(parseStartResponse(wire(route))).toEqual(route);
  });

  it("rejects a start response missing cascade_targets", () => {
    expect(() =>
      parseStartResponse(
        wire(startResponseExample, (copy) => {
          delete record((copy.route_intersections as unknown[])[0]).cascade_targets;
        }),
      ),
    ).toThrow(TypeError);
  });

  it.each([
    ["schema_version !== 1.0", (c: Record<string, unknown>) => (c.schema_version = "2.0")],
    ["is_simulated !== true", (c: Record<string, unknown>) => (c.is_simulated = false)],
    [
      "route_geometry with < 2 coordinates",
      (c: Record<string, unknown>) => (record(c.route_geometry).coordinates = [[19.9, 50.06]]),
    ],
    [
      "a non-finite estimate",
      (c: Record<string, unknown>) => (c.estimated_greenwave_time_sec = JSON.parse("1e999")),
    ],
    [
      "a non-finite standard estimate",
      (c: Record<string, unknown>) => (c.estimated_standard_time_sec = JSON.parse("1e999")),
    ],
    [
      "a missing standard estimate",
      (c: Record<string, unknown>) => delete c.estimated_standard_time_sec,
    ],
    [
      "a route intersection without a position",
      (c: Record<string, unknown>) =>
        delete record((c.route_intersections as unknown[])[0]).position,
    ],
    [
      "a route intersection without a kind",
      (c: Record<string, unknown>) => delete record((c.route_intersections as unknown[])[0]).kind,
    ],
    [
      "a route intersection with an unknown kind",
      (c: Record<string, unknown>) =>
        (record((c.route_intersections as unknown[])[0]).kind = "roundabout"),
    ],
    [
      "a route intersection with a prototype-property kind",
      (c: Record<string, unknown>) =>
        (record((c.route_intersections as unknown[])[0]).kind = "__proto__"),
    ],
    ["a missing snapped endpoint", (c: Record<string, unknown>) => delete c.origin_snapped],
  ])("rejects %s", (_label, mutate) => {
    expect(() => parseStartResponse(wire(startResponseExample, mutate))).toThrow(TypeError);
  });

  it("rejects a non-object body", () => {
    expect(() => parseStartResponse("INITIALIZED")).toThrow(TypeError);
    expect(() => parseStartResponse(null)).toThrow(TypeError);
  });
});

describe("parseStreamEvent", () => {
  it.each([
    ["SIMULATION_TICK", tickEventExample],
    ["ITS_DISPATCH", itsDispatchEventExample],
    ["SIMULATION_COMPLETED", completedEventExample],
    ["SIMULATION_CANCELLED", cancelledEventExample],
  ])("accepts the architecture %s example", (_type, example) => {
    expect(parseStreamEvent(wire(example), SIMULATION_ID)).toEqual(example);
  });

  it("accepts a passed intersection with null TTI and null name", () => {
    const event = wire(tickEventExample, (c) => {
      const first = record((c.intersections as unknown[])[0]);
      first.tti_seconds = null;
      first.name = null;
    });
    expect(parseStreamEvent(event, SIMULATION_ID)).not.toBeNull();
  });

  it.each([
    ["schema_version !== 1.0", (c: Record<string, unknown>) => (c.schema_version = "2.0")],
    ["is_simulated !== true", (c: Record<string, unknown>) => (c.is_simulated = false)],
    ["a wrong simulation_id", (c: Record<string, unknown>) => (c.simulation_id = "SIM-OTHER")],
    [
      "a missing ambulance.position.lat",
      (c: Record<string, unknown>) => delete record(record(c.ambulance).position).lat,
    ],
    [
      "a non-finite speed",
      (c: Record<string, unknown>) => (record(c.ambulance).speed_kmh = JSON.parse("1e999")),
    ],
    [
      "an unknown state string",
      (c: Record<string, unknown>) =>
        (record((c.intersections as unknown[])[1]).state = "CLEARING_CASCADE"),
    ],
    [
      "an unknown ambulance status",
      (c: Record<string, unknown>) => (record(c.ambulance).status = "PARKED"),
    ],
    ["a negative tick", (c: Record<string, unknown>) => (c.tick = -1)],
  ])("drops a tick with %s", (_label, mutate) => {
    expect(parseStreamEvent(wire(tickEventExample, mutate), SIMULATION_ID)).toBeNull();
  });

  it("drops an ITS dispatch without an intersections group", () => {
    const event = wire(
      itsDispatchEventExample,
      (c) => delete record(c.payload).intersections_group,
    );
    expect(parseStreamEvent(event, SIMULATION_ID)).toBeNull();
  });

  it("accepts a server-error cancellation", () => {
    const event = wire(cancelledEventExample, (c) => (c.reason = "SERVER_ERROR"));
    expect(parseStreamEvent(event, SIMULATION_ID)).toMatchObject({
      event_type: "SIMULATION_CANCELLED",
      reason: "SERVER_ERROR",
    });
  });

  it("drops a cancellation with an unknown reason", () => {
    const event = wire(cancelledEventExample, (c) => (c.reason = "CRASHED"));
    expect(parseStreamEvent(event, SIMULATION_ID)).toBeNull();
  });

  it("ignores an unknown event_type with a warning instead of throwing", () => {
    const event = wire(tickEventExample, (c) => (c.event_type = "SIMULATION_PAUSED"));
    expect(parseStreamEvent(event, SIMULATION_ID)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SIMULATION_PAUSED"));
  });
});

describe("parseErrorResponse", () => {
  it("accepts the architecture ErrorResponse example", () => {
    expect(parseErrorResponse(wire(errorResponseExample))).toEqual(errorResponseExample);
  });

  it("returns null for FastAPI's default validation body and unknown codes", () => {
    expect(parseErrorResponse({ detail: [{ loc: ["body"], msg: "x", type: "y" }] })).toBeNull();
    expect(
      parseErrorResponse(wire(errorResponseExample, (c) => (c.error_code = "TEAPOT"))),
    ).toBeNull();
    expect(parseErrorResponse(undefined)).toBeNull();
  });
});

describe("validateDatasetQuality", () => {
  it("accepts a quality summary", () => {
    expect(validateDatasetQuality(wire(datasetQualityExample))).toEqual(datasetQualityExample);
  });

  it("rejects a body with is_simulated false", () => {
    const body = wire(datasetQualityExample, (copy) => {
      copy.is_simulated = false;
    });
    expect(() => validateDatasetQuality(body)).toThrow(/is_simulated/);
  });

  it("rejects an unknown check status", () => {
    const body = wire(datasetQualityExample, (copy) => {
      (copy.checks as Record<string, unknown>[])[0].status = "fail";
    });
    expect(() => validateDatasetQuality(body)).toThrow(/checks\[0\]\.status/);
  });

  it("rejects a non-numeric metric", () => {
    const body = wire(datasetQualityExample, (copy) => {
      (copy.checks as { metrics: Record<string, unknown> }[])[0].metrics.tertiary_plus_cases = "19";
    });
    expect(() => validateDatasetQuality(body)).toThrow(/metrics\.tertiary_plus_cases/);
  });

  it("accepts a null MSIP timestamp", () => {
    const body = wire(datasetQualityExample, (copy) => {
      copy.msip_export_timestamp = null;
    });
    expect(validateDatasetQuality(body).msip_export_timestamp).toBeNull();
  });
});

describe("ER Green Wave mode and signal phases", () => {
  const PHASE = {
    intersection_id: "INT-0360",
    signal_key: "OSM-L4",
    kind: "VEHICLE",
    color: "GREEN",
    position: { lat: 50.0612, lng: 19.9571 },
    accessible_label: "Simulated vehicle signal OSM-L4 at INT-0360: green",
  };
  const withPhase = (mutate: (phase: Record<string, unknown>) => void = () => undefined) =>
    wire(tickEventExample, (c) => {
      const phase: Record<string, unknown> = JSON.parse(JSON.stringify(PHASE));
      mutate(phase);
      c.signal_phases = [phase];
    });

  it.each(["ENABLED", "DISABLED"])("accepts a start response in %s mode", (mode) => {
    const body = wire(startResponseExample, (c) => (c.green_wave_mode = mode));
    expect(parseStartResponse(body).green_wave_mode).toBe(mode);
  });

  it.each([
    ["a missing mode", (c: Record<string, unknown>) => delete c.green_wave_mode],
    ["an unknown mode", (c: Record<string, unknown>) => (c.green_wave_mode = "OFF")],
  ])("rejects a start response with %s", (_label, mutate) => {
    expect(() => parseStartResponse(wire(startResponseExample, mutate))).toThrow(TypeError);
  });

  it("accepts a tick with a valid phase indicator", () => {
    expect(parseStreamEvent(withPhase(), SIMULATION_ID)).not.toBeNull();
  });

  it("rejects two phase indicators with the same intersection, signal and kind", () => {
    const event = wire(tickEventExample, (c) => {
      c.signal_phases = [PHASE, { ...PHASE, color: "RED" }];
    });
    expect(parseStreamEvent(event, SIMULATION_ID)).toBeNull();
  });

  it("accepts the vehicle and pedestrian indicators of one signal", () => {
    const event = wire(tickEventExample, (c) => {
      c.signal_phases = [PHASE, { ...PHASE, kind: "PEDESTRIAN" }];
    });
    expect(parseStreamEvent(event, SIMULATION_ID)).not.toBeNull();
  });

  it("rejects a tick without signal_phases", () => {
    const event = wire(tickEventExample, (c) => delete c.signal_phases);
    expect(parseStreamEvent(event, SIMULATION_ID)).toBeNull();
  });

  it.each([
    ["an unknown colour", (p: Record<string, unknown>) => (p.color = "AMBER")],
    ["an unknown kind", (p: Record<string, unknown>) => (p.kind = "CYCLIST")],
    ["a missing position", (p: Record<string, unknown>) => delete p.position],
    [
      "a non-finite position",
      (p: Record<string, unknown>) => (record(p.position).lat = JSON.parse("1e999")),
    ],
    ["a missing signal key", (p: Record<string, unknown>) => delete p.signal_key],
    ["a missing label", (p: Record<string, unknown>) => delete p.accessible_label],
  ])("rejects a phase indicator with %s", (_label, mutate) => {
    expect(parseStreamEvent(withPhase(mutate), SIMULATION_ID)).toBeNull();
  });
});

describe("parseComparisonStartResponse", () => {
  const pair = {
    schema_version: "1.0",
    is_simulated: true,
    enabled: { ...startResponseExample, simulation_id: "pair-e", green_wave_mode: "ENABLED" },
    disabled: { ...startResponseExample, simulation_id: "pair-d", green_wave_mode: "DISABLED" },
  };
  it("accepts both runs of the pair", () => {
    expect(parseComparisonStartResponse(wire(pair))).toEqual(pair);
  });
  it("rejects a member in the wrong mode", () => {
    expect(() =>
      parseComparisonStartResponse(
        wire(pair, (copy) => {
          record(copy.disabled).green_wave_mode = "ENABLED";
        }),
      ),
    ).toThrow(/disabled/);
  });
  it("rejects an invalid member route", () => {
    expect(() =>
      parseComparisonStartResponse(
        wire(pair, (copy) => {
          record(copy.enabled).route_geometry = null;
        }),
      ),
    ).toThrow(/enabled/);
  });
});

const LEG = { access_point: { lat: 50.06, lng: 19.91 }, distance_m: 650, seconds: 464 };

describe("on-foot legs", () => {
  it("accepts a start response with a missing, null or valid destination_on_foot", () => {
    expect(() => parseStartResponse(wire(startResponseExample))).not.toThrow();
    for (const leg of [null, LEG]) {
      const body = wire(startResponseExample, (copy) => {
        copy.destination_on_foot = leg;
      });
      expect(record(parseStartResponse(body)).destination_on_foot).toEqual(leg);
    }
  });

  it("rejects a negative destination_on_foot distance", () => {
    const body = wire(startResponseExample, (copy) => {
      copy.destination_on_foot = { ...LEG, distance_m: -1 };
    });
    expect(() => parseStartResponse(body)).toThrow("destination_on_foot.distance_m");
  });

  const rank = (onFoot?: unknown) => ({
    schema_version: "1.0",
    incident_snapped: { position: { lat: 50.06, lng: 19.91 }, snap_distance_m: 500 },
    candidates: [
      {
        station: {
          station_id: "STN-A-0001",
          vehicle_type: "AMBULANCE",
          source_kind: "prm_base",
          name: "A",
          position: { lat: 50.05, lng: 19.9 },
        },
        greenwave_seconds: 140,
        standard_seconds: 190,
        distance_m: 2000,
        ...(onFoot === undefined ? {} : { on_foot: onFoot }),
      },
    ],
    scenario_time: "2026-10-27T12:00:00",
    outcome: "OK",
    incident_area: null,
    excluded_teams: [],
    roster: null,
    area_rule: null,
  });

  it("defaults a missing candidate on_site to false and rejects a non-boolean one", () => {
    expect(validateRank(wire(rank())).candidates[0].on_site).toBe(false);
    const onSite = record(wire(rank()));
    record((onSite.candidates as unknown[])[0]).on_site = true;
    expect(validateRank(onSite).candidates[0].on_site).toBe(true);
    record((onSite.candidates as unknown[])[0]).on_site = "yes";
    expect(() => validateRank(onSite)).toThrow("candidates[0].on_site");
  });

  it("accepts a PRM base station", () => {
    const body = record(wire(rank()));
    const candidate = record((body.candidates as unknown[])[0]);
    record(candidate.station).source_kind = "prm_base";
    expect(validateRank(body).candidates[0].station.source_kind).toBe("prm_base");
  });

  it("accepts rank candidates with a missing, null or valid on_foot", () => {
    for (const leg of [undefined, null, LEG]) {
      expect(() => validateRank(wire(rank(leg)))).not.toThrow();
    }
  });

  it.each([
    ["missing", undefined],
    ["non-finite", JSON.parse("1e999")],
    ["negative", -1],
  ])("rejects a %s candidate standard_seconds", (_label, value) => {
    const body = record(wire(rank()));
    record((body.candidates as unknown[])[0]).standard_seconds = value;
    expect(() => validateRank(body)).toThrow("candidates[0].standard_seconds");
  });

  it("rejects a negative candidate on_foot distance", () => {
    expect(() => validateRank(wire(rank({ ...LEG, distance_m: -1 })))).toThrow(
      "candidates[0].on_foot.distance_m",
    );
  });
});

it.each([
  { controlled_edge_ids: [42] },
  { controlled_edge_ids: "edge-a" },
  { is_route_movement: "yes" },
])("rejects malformed signal movement context: %j", (patch) => {
  const value = wire(tickEventExample, (copy) => {
    const phases = copy.signal_phases as Array<Record<string, unknown>>;
    Object.assign(phases[0], patch);
  });
  expect(parseStreamEvent(value, SIMULATION_ID)).toBeNull();
});

describe("validateGeocode", () => {
  const matched = {
    label: "Zabłocie 18",
    position: { lat: 50.05, lng: 19.96 },
    provenance: "matched",
    osm_delta_m: 442,
    disagreement_m: 442,
    osm_position: { lat: 50.051, lng: 19.965 },
    osm_same_key_elsewhere: false,
  };
  const body = (result: Record<string, unknown>) => ({ schema_version: "1.0", results: [result] });

  it("accepts every provenance with its optional fields", () => {
    expect(validateGeocode(body(matched)).results[0].provenance).toBe("matched");
    expect(() =>
      validateGeocode(body({ label: "A 1", position: matched.position, provenance: "osm" })),
    ).not.toThrow();
    expect(() =>
      validateGeocode(
        body({
          ...matched,
          provenance: "municipal",
          osm_delta_m: null,
          disagreement_m: null,
          osm_position: null,
          osm_same_key_elsewhere: true,
        }),
      ),
    ).not.toThrow();
  });

  it("rejects a missing or unknown provenance", () => {
    expect(() => validateGeocode(body({ ...matched, provenance: undefined }))).toThrow(
      "results[0].provenance",
    );
    expect(() => validateGeocode(body({ ...matched, provenance: "x" }))).toThrow(
      "results[0].provenance",
    );
  });

  it("rejects a negative offset and a non-boolean same-key flag", () => {
    expect(() => validateGeocode(body({ ...matched, osm_delta_m: -1 }))).toThrow(
      "results[0].osm_delta_m",
    );
    expect(() => validateGeocode(body({ ...matched, osm_same_key_elsewhere: "no" }))).toThrow(
      "results[0].osm_same_key_elsewhere",
    );
  });

  it("requires the OSM position exactly when there is a disagreement", () => {
    expect(() => validateGeocode(body({ ...matched, osm_position: null }))).toThrow(
      "results[0].osm_position",
    );
    expect(() =>
      validateGeocode(body({ ...matched, disagreement_m: null, osm_delta_m: 40 })),
    ).toThrow("results[0].osm_position");
  });
});

describe("resource-aware ambulance ranking (ADR 0014)", () => {
  it("accepts a team-ranked response", () => {
    expect(validateRank(wire(TEAM_RANK))).toEqual(TEAM_RANK);
  });

  it("accepts no candidates only with the no-eligible outcome", () => {
    expect(validateRank(wire(NO_ELIGIBLE_RANK)).candidates).toEqual([]);
    expect(() => validateRank(wire(NO_ELIGIBLE_RANK, (copy) => (copy.outcome = "OK")))).toThrow(
      "candidates",
    );
    expect(() =>
      validateRank(wire(TEAM_RANK, (copy) => (copy.outcome = "NO_ELIGIBLE_RESOURCE"))),
    ).toThrow("candidates");
  });

  it("rejects four candidates", () => {
    const body = wire(TEAM_RANK, (copy) => {
      const list = copy.candidates as unknown[];
      copy.candidates = [...list, ...list];
    });
    expect(() => validateRank(body)).toThrow("candidates");
  });

  it.each([
    ["outcome", (c: Record<string, unknown>) => (c.outcome = "MAYBE")],
    ["scenario_time", (c: Record<string, unknown>) => (c.scenario_time = 5)],
    [
      "excluded_teams[0].reason",
      (c: Record<string, unknown>) => {
        record((c.excluded_teams as unknown[])[0]).reason = "ASLEEP";
      },
    ],
    ["area_rule.reason", (c: Record<string, unknown>) => (record(c.area_rule).reason = "CLOSEST")],
    [
      "area_rule.delta_seconds",
      (c: Record<string, unknown>) => {
        record(c.area_rule).delta_seconds = "40";
      },
    ],
    [
      "area_rule.margin_seconds",
      (c: Record<string, unknown>) => {
        delete record(c.area_rule).margin_seconds;
      },
    ],
    [
      "incident_area.district_number",
      (c: Record<string, unknown>) => {
        record(c.incident_area).district_number = 0;
      },
    ],
    [
      "roster.teams_in_scope",
      (c: Record<string, unknown>) => (record(c.roster).teams_in_scope = -1),
    ],
    [
      "candidates[0].team.availability",
      (c: Record<string, unknown>) => {
        record(record((c.candidates as unknown[])[0]).team).availability = "live";
      },
    ],
    [
      "candidates[0].team.in_area",
      (c: Record<string, unknown>) => {
        record(record((c.candidates as unknown[])[0]).team).in_area = "yes";
      },
    ],
    [
      "candidates[0].selection_reason",
      (c: Record<string, unknown>) => {
        record((c.candidates as unknown[])[0]).selection_reason = "CLOSEST";
      },
    ],
  ])("rejects a malformed %s", (path, mutate) => {
    expect(() => validateRank(wire(TEAM_RANK, mutate))).toThrow(path);
  });

  it("validates GET /resources", () => {
    expect(validateResources(wire(RESOURCES))).toEqual(RESOURCES);
    expect(() =>
      validateResources(
        wire(RESOURCES, (c) => {
          record((c.teams as unknown[])[0]).on_shift = "no";
        }),
      ),
    ).toThrow("teams[0].on_shift");
    expect(() => validateResources(wire(RESOURCES, (c) => (c.roster = null)))).toThrow("roster");
  });
});
