/**
 * Runtime guards at the wire boundary (D23). They check the envelope
 * (`schema_version`, `is_simulated`, `event_type`, `simulation_id`) and exactly
 * the fields the UI dereferences; they are not a second schema. The canonical
 * shapes are the generated types; the enum tables below are typed against them
 * so a contract change fails compilation here.
 */
import type {
  AddressProvenance,
  AreaRuleOutcome,
  ExcludedTeam,
  ResourcesResponse,
  TeamAssignment,
  AmbulanceStatus,
  CancelReason,
  ComparisonStartResponse,
  CrossingStrategy,
  DatasetQualityResponse,
  DispatchRankResponse,
  ErrorCode,
  ErrorResponse,
  GeocodeResponse,
  GreenWaveMode,
  IntersectionState,
  ItsRequestStatus,
  ItsScenario,
  QualityStatus,
  RouteIntersection,
  SignalMovementKind,
  SignalPhaseColor,
  SimulationStartResponse,
  SimulationStreamEvent,
  StationSourceKind,
  StationsResponse,
  VehicleType,
} from "@/types/telemetry";

const INTERSECTION_STATES: Record<IntersectionState, true> = {
  NORMAL: true,
  CLEARING: true,
  PRIORITY_GREEN: true,
  RECOVERY: true,
};
const INTERSECTION_KINDS: Record<RouteIntersection["kind"], true> = {
  signalised_junction: true,
  midblock_signal: true,
  pedestrian_crossing: true,
};
const AMBULANCE_STATUSES: Record<AmbulanceStatus, true> = {
  EN_ROUTE: true,
  APPROACHING_INTERSECTION: true,
  CROSSING_INTERSECTION: true,
  ARRIVED: true,
};
const GREEN_WAVE_MODES: Record<GreenWaveMode, true> = { ENABLED: true, DISABLED: true };
const SIGNAL_PHASE_COLORS: Record<SignalPhaseColor, true> = {
  RED: true,
  YELLOW: true,
  GREEN: true,
};
const SIGNAL_MOVEMENT_KINDS: Record<SignalMovementKind, true> = {
  VEHICLE: true,
  PEDESTRIAN: true,
};
const CANCEL_REASONS: Record<CancelReason, true> = {
  STOPPED: true,
  SUPERSEDED: true,
  SERVER_ERROR: true,
  ITS_REJECTED: true,
  ITS_TIMEOUT: true,
  ITS_HOLD_EXPIRED: true,
};
const ERROR_CODES: Record<ErrorCode, true> = {
  ORIGIN_OFF_NETWORK: true,
  DESTINATION_OFF_NETWORK: true,
  NO_ROUTE: true,
  SIMULATION_ID_IN_USE: true,
  SIMULATION_NOT_FOUND: true,
  NO_STATION_REACHABLE: true,
};
const VEHICLE_TYPES: Record<VehicleType, true> = {
  AMBULANCE: true,
  FIRE_TRUCK: true,
  POLICE_CAR: true,
};
const STATION_SOURCE_KINDS: Record<StationSourceKind, true> = {
  prm_base: true,
  fire_state: true,
  fire_volunteer: true,
  fire_other: true,
  police: true,
};
// Typed against the contract: a new enum value fails the type check, not the run.
const ITS_SCENARIOS: Record<ItsScenario, true> = {
  NOMINAL: true,
  DELAYED: true,
  REJECTED: true,
  NO_FEEDBACK: true,
  MIXED: true,
};
const CROSSING_STRATEGIES: Record<CrossingStrategy, true> = {
  PRIORITY: true,
  STANDARD_FALLBACK: true,
};
const ITS_REQUEST_STATUSES: Record<ItsRequestStatus, true> = {
  REQUESTED: true,
  ACCEPTED: true,
  RELEASED: true,
  REJECTED: true,
  TIMED_OUT: true,
  EXPIRED: true,
};
const STATION_ID = /^STN-[AFP]-\d{4}$/;
const STREAM_EVENT_TYPES: Record<SimulationStreamEvent["event_type"], true> = {
  SIMULATION_TICK: true,
  ITS_DISPATCH: true,
  ITS_FEEDBACK: true,
  SIMULATION_COMPLETED: true,
  SIMULATION_CANCELLED: true,
};

const ADDRESS_PROVENANCES: Record<AddressProvenance, true> = {
  matched: true,
  municipal: true,
  osm: true,
};

const QUALITY_STATUSES: Record<QualityStatus, true> = { pass: true, info: true, warn: true };
const OUTCOMES: Record<DispatchRankResponse["outcome"], true> = {
  OK: true,
  NO_ELIGIBLE_RESOURCE: true,
};
const EXCLUSION_REASONS: Record<ExcludedTeam["reason"], true> = {
  OFF_SHIFT: true,
  BUSY_OVERRIDE: true,
};
const SELECTION_REASONS: Record<AreaRuleOutcome["reason"], true> = {
  NEAREST: true,
  IN_AREA_WITHIN_MARGIN: true,
  NEAREST_OUTSIDE_MARGIN: true,
};
const TEAM_AVAILABILITIES: Record<TeamAssignment["availability"], true> = {
  free: true,
  assumed_free: true,
};

type UnknownRecord = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new TypeError(`${path}: expected ${expected}`);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
  return isRecord(value) ? value : fail(path, "an object");
}

function finite(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(path, "a finite number");
}

function positiveInteger(value: unknown, path: string): number {
  const number = finite(value, path);
  return Number.isInteger(number) && number >= 1 ? number : fail(path, "a positive integer");
}

function text(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "a string");
}

function nullableText(value: unknown, path: string): void {
  if (value !== null) text(value, path);
}

function bool(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(path, "a boolean");
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(path, "an array");
}

function member<T extends string>(table: Record<T, true>, value: unknown, path: string): T {
  return typeof value === "string" && Object.hasOwn(table, value)
    ? (value as T)
    : fail(path, `one of ${Object.keys(table).join(", ")}`);
}

function position(value: unknown, path: string): void {
  const point = record(value, path);
  finite(point.lat, `${path}.lat`);
  finite(point.lng, `${path}.lng`);
}

function envelope(value: UnknownRecord): void {
  if (value.schema_version !== "1.0") fail("schema_version", '"1.0"');
  if (value.is_simulated !== true) fail("is_simulated", "true");
  text(value.simulation_id, "simulation_id");
}

function streamEnvelope(value: UnknownRecord, expectedSimulationId: string): void {
  envelope(value);
  if (value.simulation_id !== expectedSimulationId) {
    fail("simulation_id", `"${expectedSimulationId}"`);
  }
  const tick = finite(value.tick, "tick");
  if (!Number.isInteger(tick) || tick < 0) fail("tick", "a non-negative integer");
  text(value.timestamp, "timestamp");
}

function kpiMetrics(value: unknown, path: string): void {
  const kpi = record(value, path);
  finite(kpi.current_time_saved_sec, `${path}.current_time_saved_sec`);
  finite(kpi.total_time_elapsed_sec, `${path}.total_time_elapsed_sec`);
}

function snappedEndpoint(value: unknown, path: string): void {
  const endpoint = record(value, path);
  position(endpoint.position, `${path}.position`);
  finite(endpoint.snap_distance_m, `${path}.snap_distance_m`);
}

/** An optional on-foot leg (off-road incident): absent, `null`, or a valid leg. */
function optionalOnFootLeg(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  const leg = record(value, path);
  position(leg.access_point, `${path}.access_point`);
  nonNegative(leg.distance_m, `${path}.distance_m`);
  nonNegative(leg.seconds, `${path}.seconds`);
}

/** Throws `TypeError` naming the first offending field. */
export function parseStartResponse(value: unknown): SimulationStartResponse {
  const body = record(value, "response");
  envelope(body);
  if (body.status !== "INITIALIZED") fail("status", '"INITIALIZED"');

  routeGeometry(body.route_geometry, "route_geometry");

  finite(body.total_distance_m, "total_distance_m");
  finite(body.estimated_normal_time_sec, "estimated_normal_time_sec");
  finite(body.estimated_greenwave_time_sec, "estimated_greenwave_time_sec");
  finite(body.estimated_standard_time_sec, "estimated_standard_time_sec");
  list(body.intersections_on_route, "intersections_on_route").forEach((id, index) =>
    text(id, `intersections_on_route[${index}]`),
  );
  list(body.route_intersections, "route_intersections").forEach((item, index) => {
    const path = `route_intersections[${index}]`;
    const intersection = record(item, path);
    text(intersection.id, `${path}.id`);
    nullableText(intersection.name, `${path}.name`);
    member(INTERSECTION_KINDS, intersection.kind, `${path}.kind`);
    position(intersection.position, `${path}.position`);
    finite(intersection.distance_along_route_m, `${path}.distance_along_route_m`);
    positiveInteger(intersection.signal_count, `${path}.signal_count`);
    positiveInteger(intersection.approach_count, `${path}.approach_count`);
    bool(intersection.needs_review, `${path}.needs_review`);
    list(intersection.cascade_targets, `${path}.cascade_targets`).forEach((id, targetIndex) =>
      text(id, `${path}.cascade_targets[${targetIndex}]`),
    );
  });
  snappedEndpoint(body.origin_snapped, "origin_snapped");
  snappedEndpoint(body.destination_snapped, "destination_snapped");
  optionalOnFootLeg(body.destination_on_foot, "destination_on_foot");
  member(GREEN_WAVE_MODES, body.green_wave_mode, "green_wave_mode");
  member(ITS_SCENARIOS, body.its_scenario ?? "NOMINAL", "its_scenario");
  const seed = finite(body.its_outcome_seed ?? 0, "its_outcome_seed");
  if (!Number.isInteger(seed) || seed < 0) fail("its_outcome_seed", "a non-negative integer");
  return {
    ...body,
    its_scenario: body.its_scenario ?? "NOMINAL",
    its_outcome_seed: seed,
  } as SimulationStartResponse;
}

function checkItsStatus(event: UnknownRecord, snapshot: boolean): void {
  const status = member(ITS_REQUEST_STATUSES, event.status, "status");
  if (!snapshot && status === "REQUESTED") fail("status", "feedback status");
  const expected =
    status === "REJECTED"
      ? "CONTROLLER_REJECTED"
      : status === "TIMED_OUT"
        ? "ACK_TIMEOUT"
        : status === "EXPIRED"
          ? "HOLD_EXPIRED"
          : null;
  if ((event.reason ?? null) !== expected) fail("reason", "reason matching status");
  const targets = list(event.intersections_group, "intersections_group");
  if (!targets.length || new Set(targets).size !== targets.length)
    fail("intersections_group", "unique nonempty targets");
  targets.forEach((id) => text(id, "target"));
}

/** Both runs of a comparison pair (ADR 0008); errors name the member (`enabled.…`). */
export function parseComparisonStartResponse(value: unknown): ComparisonStartResponse {
  const body = record(value, "response");
  if (body.schema_version !== "1.0") fail("schema_version", '"1.0"');
  if (body.is_simulated !== true) fail("is_simulated", "true");
  const parsedRun = (key: "enabled" | "disabled"): SimulationStartResponse => {
    let run: SimulationStartResponse;
    try {
      run = parseStartResponse(body[key]);
    } catch (error) {
      throw new TypeError(`${key}.${error instanceof Error ? error.message : "invalid"}`);
    }
    const mode = key === "enabled" ? "ENABLED" : "DISABLED";
    if (run.green_wave_mode !== mode) fail(`${key}.green_wave_mode`, `"${mode}"`);
    return run;
  };
  // The parsed members carry parseStartResponse's defaults (its_scenario).
  return {
    ...body,
    enabled: parsedRun("enabled"),
    disabled: parsedRun("disabled"),
  } as ComparisonStartResponse;
}

function checkStreamEvent(
  event: UnknownRecord,
  eventType: SimulationStreamEvent["event_type"],
): void {
  switch (eventType) {
    case "SIMULATION_TICK": {
      const ambulance = record(event.ambulance, "ambulance");
      text(ambulance.id, "ambulance.id");
      position(ambulance.position, "ambulance.position");
      finite(ambulance.speed_kmh, "ambulance.speed_kmh");
      member(AMBULANCE_STATUSES, ambulance.status, "ambulance.status");
      kpiMetrics(event.kpi_metrics, "kpi_metrics");
      list(event.intersections, "intersections").forEach((item, index) => {
        const path = `intersections[${index}]`;
        const intersection = record(item, path);
        text(intersection.id, `${path}.id`);
        nullableText(intersection.name, `${path}.name`);
        member(INTERSECTION_STATES, intersection.state, `${path}.state`);
        bool(intersection.is_cascade, `${path}.is_cascade`);
        bool(intersection.is_active_corridor, `${path}.is_active_corridor`);
        if (intersection.crossing_strategy != null)
          member(CROSSING_STRATEGIES, intersection.crossing_strategy, `${path}.crossing_strategy`);
        if (intersection.tti_seconds !== null) {
          finite(intersection.tti_seconds, `${path}.tti_seconds`);
        }
      });
      if (event.its_observed_at_simulated_sec != null)
        nonNegative(event.its_observed_at_simulated_sec, "its_observed_at_simulated_sec");
      const known = new Set(
        list(event.intersections, "intersections").map((i) => record(i, "intersection").id),
      );
      list(event.its_requests ?? [], "its_requests").forEach((value) => {
        const r = record(value, "its_request");
        checkItsStatus(r, true);
        text(r.message_id, "message_id");
        nonNegative(r.submitted_at_simulated_sec, "submitted_at_simulated_sec");
        nonNegative(r.last_updated_at_simulated_sec, "last_updated_at_simulated_sec");
        const seq = finite(r.last_feedback_sequence ?? 0, "last_feedback_sequence");
        if (
          !Number.isInteger(seq) ||
          seq < 0 ||
          (r.status !== "REQUESTED" && seq === 0) ||
          (r.status === "REQUESTED" && seq !== 0)
        )
          fail("last_feedback_sequence", "lifecycle sequence");
        if (r.acknowledged_at_simulated_sec != null)
          nonNegative(r.acknowledged_at_simulated_sec, "acknowledged_at_simulated_sec");
        if (r.status === "ACCEPTED" && r.acknowledged_at_simulated_sec == null)
          fail("acknowledged_at_simulated_sec", "acceptance time");
        if (
          finite(r.last_updated_at_simulated_sec, "update") <
          finite(r.submitted_at_simulated_sec, "submitted")
        )
          fail("last_updated_at_simulated_sec", "time after submission");
        list(r.intersections_group, "targets").forEach((id) => {
          if (!known.has(id)) fail("targets", "known route targets");
        });
      });
      // The map keys each marker by (intersection, signal, kind); a duplicate would be ambiguous.
      const identities = new Set<string>();
      list(event.signal_phases, "signal_phases").forEach((item, index) => {
        const path = `signal_phases[${index}]`;
        const phase = record(item, path);
        text(phase.intersection_id, `${path}.intersection_id`);
        text(phase.signal_key, `${path}.signal_key`);
        member(SIGNAL_MOVEMENT_KINDS, phase.kind, `${path}.kind`);
        if (phase.controlled_edge_ids !== undefined)
          list(phase.controlled_edge_ids, `${path}.controlled_edge_ids`).forEach((edge, i) =>
            text(edge, `${path}.controlled_edge_ids[${i}]`),
          );
        if (phase.is_route_movement !== undefined)
          bool(phase.is_route_movement, `${path}.is_route_movement`);
        member(SIGNAL_PHASE_COLORS, phase.color, `${path}.color`);
        position(phase.position, `${path}.position`);
        text(phase.accessible_label, `${path}.accessible_label`);
        const identity = JSON.stringify([phase.intersection_id, phase.signal_key, phase.kind]);
        if (identities.has(identity)) fail(path, "a unique intersection, signal and kind");
        identities.add(identity);
      });
      return;
    }
    case "ITS_FEEDBACK": {
      checkItsStatus(event, false);
      positiveInteger(event.feedback_sequence, "feedback_sequence");
      text(event.request_message_id, "request_message_id");
      nonNegative(event.observed_at_simulated_sec, "observed_at_simulated_sec");
      return;
    }
    case "ITS_DISPATCH": {
      text(event.message_id, "message_id");
      const payload = record(event.payload, "payload");
      text(payload.action, "payload.action");
      list(payload.intersections_group, "payload.intersections_group").forEach((id, index) =>
        text(id, `payload.intersections_group[${index}]`),
      );
      finite(payload.hold_duration_sec, "payload.hold_duration_sec");
      text(payload.expected_arrival_utc, "payload.expected_arrival_utc");
      return;
    }
    case "SIMULATION_COMPLETED":
      kpiMetrics(event.kpi_metrics, "kpi_metrics");
      list(event.fallback_intersection_ids ?? [], "fallback_intersection_ids").forEach((id, i) =>
        text(id, `fallback_intersection_ids[${i}]`),
      );
      return;
    case "SIMULATION_CANCELLED":
      member(CANCEL_REASONS, event.reason, "reason");
      return;
  }
}

function warnDropped(reason: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[simulation stream] ${reason}`);
}

/**
 * Returns the event, or null to drop it silently (a dev-mode warning says why):
 * invalid payloads, events of another simulation and unknown `event_type`s.
 */
export function parseStreamEvent(
  value: unknown,
  expectedSimulationId: string,
): SimulationStreamEvent | null {
  if (!isRecord(value)) {
    warnDropped("dropped event: not an object");
    return null;
  }
  if (
    typeof value.event_type !== "string" ||
    !Object.hasOwn(STREAM_EVENT_TYPES, value.event_type)
  ) {
    warnDropped(`ignored unknown event_type ${String(value.event_type)}`);
    return null;
  }
  const eventType = value.event_type as SimulationStreamEvent["event_type"];
  try {
    streamEnvelope(value, expectedSimulationId);
    checkStreamEvent(value, eventType);
  } catch (error) {
    warnDropped(`dropped ${eventType}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return (
    eventType === "SIMULATION_TICK"
      ? {
          ...value,
          // Contract defaults the backend may omit.
          its_requests: ((value.its_requests ?? []) as UnknownRecord[]).map((r) => ({
            ...r,
            last_feedback_sequence: r.last_feedback_sequence ?? 0,
            acknowledged_at_simulated_sec: r.acknowledged_at_simulated_sec ?? null,
            reason: r.reason ?? null,
          })),
          its_observed_at_simulated_sec: value.its_observed_at_simulated_sec ?? null,
        }
      : eventType === "SIMULATION_COMPLETED"
        ? { ...value, fallback_intersection_ids: value.fallback_intersection_ids ?? [] }
        : value
  ) as SimulationStreamEvent;
}

/** Returns null for anything that is not a contract `ErrorResponse` (e.g. FastAPI's 422 body). */
export function parseErrorResponse(value: unknown): ErrorResponse | null {
  if (!isRecord(value) || value.schema_version !== "1.0") return null;
  if (typeof value.message !== "string") return null;
  if (typeof value.error_code !== "string" || !Object.hasOwn(ERROR_CODES, value.error_code)) {
    return null;
  }
  return value as ErrorResponse;
}

/** `GET /api/v1/dataset/quality` body. Throws `TypeError` naming the first offending field. */
export function validateDatasetQuality(body: unknown): DatasetQualityResponse {
  const summary = record(body, "response");
  if (summary.schema_version !== "1.0") fail("schema_version", '"1.0"');
  if (summary.is_simulated !== true) fail("is_simulated", "true");
  text(summary.manifest_sha256, "manifest_sha256");
  nullableText(summary.msip_export_timestamp, "msip_export_timestamp");
  list(summary.checks, "checks").forEach((value, index) => {
    const path = `checks[${index}]`;
    const check = record(value, path);
    for (const field of ["id", "title", "headline"] as const) {
      text(check[field], `${path}.${field}`);
    }
    member(QUALITY_STATUSES, check.status, `${path}.status`);
    for (const [name, metric] of Object.entries(record(check.metrics, `${path}.metrics`))) {
      finite(metric, `${path}.metrics.${name}`);
    }
    list(check.samples, `${path}.samples`).forEach((sample, sampleIndex) =>
      text(sample, `${path}.samples[${sampleIndex}]`),
    );
  });
  list(summary.sources, "sources").forEach((value, index) => {
    const source = record(value, `sources[${index}]`);
    for (const field of ["path", "source", "licence", "attribution", "retrieved_on"] as const) {
      text(source[field], `sources[${index}].${field}`);
    }
  });
  return summary as DatasetQualityResponse;
}

function station(value: unknown, path: string): void {
  const item = record(value, path);
  if (!STATION_ID.test(text(item.station_id, `${path}.station_id`))) {
    fail(`${path}.station_id`, "STN-[AFP]-nnnn");
  }
  member(VEHICLE_TYPES, item.vehicle_type, `${path}.vehicle_type`);
  member(STATION_SOURCE_KINDS, item.source_kind, `${path}.source_kind`);
  text(item.name, `${path}.name`);
  position(item.position, `${path}.position`);
}

function nonNegative(value: unknown, path: string): void {
  if (finite(value, path) < 0) fail(path, "a non-negative number");
}

/** `GET /api/v1/stations` body. Throws `TypeError` naming the first offending field. */
export function validateStations(body: unknown): StationsResponse {
  const response = record(body, "response");
  if (response.schema_version !== "1.0") fail("schema_version", '"1.0"');
  list(response.stations, "stations").forEach((value, index) =>
    station(value, `stations[${index}]`),
  );
  return response as StationsResponse;
}

/** `GET /api/v1/geocode` body. Throws `TypeError` naming the first offending field. */
export function validateGeocode(body: unknown): GeocodeResponse {
  const response = record(body, "response");
  if (response.schema_version !== "1.0") fail("schema_version", '"1.0"');
  list(response.results, "results").forEach((value, index) => {
    const path = `results[${index}]`;
    const result = record(value, path);
    text(result.label, `${path}.label`);
    position(result.position, `${path}.position`);
    member(ADDRESS_PROVENANCES, result.provenance, `${path}.provenance`);
    // Optional provenance details (ADR 0013): absent or `null`, else valid.
    for (const field of ["osm_delta_m", "disagreement_m"] as const) {
      if (result[field] !== undefined && result[field] !== null) {
        nonNegative(result[field], `${path}.${field}`);
      }
    }
    const disagreement = result.disagreement_m !== undefined && result.disagreement_m !== null;
    const osmPosition = result.osm_position !== undefined && result.osm_position !== null;
    if (osmPosition) position(result.osm_position, `${path}.osm_position`);
    if (disagreement !== osmPosition) {
      fail(`${path}.osm_position`, "a position exactly when disagreement_m is set");
    }
    if (result.osm_same_key_elsewhere !== undefined) {
      bool(result.osm_same_key_elsewhere, `${path}.osm_same_key_elsewhere`);
    }
  });
  return response as GeocodeResponse;
}

/** `POST /api/v1/dispatch/rank` body. Throws `TypeError` naming the first offending field. */
function textList(value: unknown, path: string): void {
  list(value, path).forEach((item, index) => text(item, `${path}[${index}]`));
}

function nullableBool(value: unknown, path: string): void {
  if (value !== null) bool(value, path);
}

function teamAssignment(value: unknown, path: string): void {
  // Fire, police and mock candidates have no team.
  if (value === undefined || value === null) return;
  const team = record(value, path);
  text(team.team_code, `${path}.team_code`);
  text(team.team_type, `${path}.team_type`);
  textList(team.area_teryt, `${path}.area_teryt`);
  nullableBool(team.in_area, `${path}.in_area`);
  member(TEAM_AVAILABILITIES, team.availability, `${path}.availability`);
  textList(team.other_eligible_team_codes, `${path}.other_eligible_team_codes`);
}

/** The ADR 0014 fields: outcome, exclusions, area, roster and the area rule. */
function resourceFields(response: UnknownRecord, candidateCount: number): void {
  text(response.scenario_time, "scenario_time");
  const outcome = member(OUTCOMES, response.outcome, "outcome");
  if ((outcome === "NO_ELIGIBLE_RESOURCE") !== (candidateCount === 0)) {
    fail("candidates", "empty exactly when outcome is NO_ELIGIBLE_RESOURCE");
  }
  list(response.excluded_teams, "excluded_teams").forEach((value, index) => {
    const path = `excluded_teams[${index}]`;
    const excluded = record(value, path);
    text(excluded.team_code, `${path}.team_code`);
    if (typeof excluded.station_id !== "string" || !STATION_ID.test(excluded.station_id)) {
      fail(`${path}.station_id`, "a station ID");
    }
    member(EXCLUSION_REASONS, excluded.reason, `${path}.reason`);
  });
  if (response.incident_area !== null) {
    const area = record(response.incident_area, "incident_area");
    text(area.teryt, "incident_area.teryt");
    text(area.delegatura_name, "incident_area.delegatura_name");
    positiveInteger(area.district_number, "incident_area.district_number");
    text(area.district_name, "incident_area.district_name");
  }
  if (response.roster !== null) roster(response.roster, "roster");
  if (response.area_rule !== null) {
    const rule = record(response.area_rule, "area_rule");
    member(SELECTION_REASONS, rule.reason, "area_rule.reason");
    text(rule.chosen_team_code, "area_rule.chosen_team_code");
    text(rule.nearest_team_code, "area_rule.nearest_team_code");
    nullableText(rule.in_area_team_code, "area_rule.in_area_team_code");
    if (rule.delta_seconds !== null) finite(rule.delta_seconds, "area_rule.delta_seconds");
    nonNegative(rule.margin_seconds, "area_rule.margin_seconds");
  }
}

function roster(value: unknown, path: string): void {
  const body = record(value, path);
  text(body.source, `${path}.source`);
  text(body.plan_update, `${path}.plan_update`);
  text(body.effective_from, `${path}.effective_from`);
  nonNegative(body.teams_in_scope, `${path}.teams_in_scope`);
}

/** `GET /api/v1/resources`: the roster and each team's published schedule at `at`. */
export function validateResources(body: unknown): ResourcesResponse {
  const response = record(body, "response");
  if (response.schema_version !== "1.0") fail("schema_version", '"1.0"');
  roster(response.roster, "roster");
  text(response.at, "at");
  list(response.teams, "teams").forEach((value, index) => {
    const path = `teams[${index}]`;
    const team = record(value, path);
    text(team.team_code, `${path}.team_code`);
    text(team.team_type, `${path}.team_type`);
    if (typeof team.station_id !== "string" || !STATION_ID.test(team.station_id)) {
      fail(`${path}.station_id`, "a station ID");
    }
    text(team.base_address, `${path}.base_address`);
    textList(team.area_teryt, `${path}.area_teryt`);
    nonNegative(team.ready_from_min, `${path}.ready_from_min`);
    nonNegative(team.ready_to_min, `${path}.ready_to_min`);
    bool(team.on_shift, `${path}.on_shift`);
  });
  return response as ResourcesResponse;
}

function routeGeometry(value: unknown, path: string): void {
  const geometry = record(value, path);
  if (geometry.type !== "LineString") fail(`${path}.type`, '"LineString"');
  const coordinates = list(geometry.coordinates, `${path}.coordinates`);
  if (coordinates.length < 2) fail(`${path}.coordinates`, "at least 2 coordinates");
  coordinates.forEach((pair, index) => {
    const pairPath = `${path}.coordinates[${index}]`;
    const lngLat = list(pair, pairPath);
    if (lngLat.length !== 2) fail(pairPath, "a [lng, lat] pair");
    finite(lngLat[0], `${pairPath}[0]`);
    finite(lngLat[1], `${pairPath}[1]`);
  });
}

export function validateRank(body: unknown): DispatchRankResponse {
  const response = record(body, "response");
  if (response.schema_version !== "1.0") fail("schema_version", '"1.0"');
  snappedEndpoint(response.incident_snapped, "incident_snapped");
  // Normalised copies: an older backend omits on_site (ADR 0012); its candidates always drive.
  const candidates = list(response.candidates, "candidates").map((value, index) => {
    const candidate = record(value, `candidates[${index}]`);
    const normalised: UnknownRecord = { ...candidate, on_site: candidate.on_site ?? false };
    return normalised;
  });
  if (candidates.length > 3) fail("candidates", "0 to 3 items");
  candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    station(candidate.station, `${path}.station`);
    nonNegative(candidate.greenwave_seconds, `${path}.greenwave_seconds`);
    nonNegative(candidate.standard_seconds, `${path}.standard_seconds`);
    nonNegative(candidate.distance_m, `${path}.distance_m`);
    if (candidate.route_geometry != null)
      routeGeometry(candidate.route_geometry, `${path}.route_geometry`);
    optionalOnFootLeg(candidate.on_foot, `${path}.on_foot`);
    bool(candidate.on_site, `${path}.on_site`);
    teamAssignment(candidate.team, `${path}.team`);
    if (candidate.selection_reason != null) {
      member(SELECTION_REASONS, candidate.selection_reason, `${path}.selection_reason`);
    }
  });
  resourceFields(response, candidates.length);
  return { ...response, candidates } as DispatchRankResponse;
}
