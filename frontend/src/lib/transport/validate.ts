/**
 * Runtime guards at the wire boundary (D23). They check the envelope
 * (`schema_version`, `is_simulated`, `event_type`, `simulation_id`) and exactly
 * the fields the UI dereferences; they are not a second schema. The canonical
 * shapes are the generated types; the enum tables below are typed against them
 * so a contract change fails compilation here.
 */
import type {
  AmbulanceStatus,
  CancelReason,
  ErrorCode,
  ErrorResponse,
  IntersectionState,
  RouteIntersection,
  SimulationStartResponse,
  SimulationStreamEvent,
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
const CANCEL_REASONS: Record<CancelReason, true> = { STOPPED: true, SUPERSEDED: true };
const ERROR_CODES: Record<ErrorCode, true> = {
  ORIGIN_OFF_NETWORK: true,
  DESTINATION_OFF_NETWORK: true,
  NO_ROUTE: true,
  SIMULATION_ID_IN_USE: true,
  SIMULATION_NOT_FOUND: true,
};
const STREAM_EVENT_TYPES: Record<SimulationStreamEvent["event_type"], true> = {
  SIMULATION_TICK: true,
  ITS_DISPATCH: true,
  SIMULATION_COMPLETED: true,
  SIMULATION_CANCELLED: true,
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

/** Throws `TypeError` naming the first offending field. */
export function parseStartResponse(value: unknown): SimulationStartResponse {
  const body = record(value, "response");
  envelope(body);
  if (body.status !== "INITIALIZED") fail("status", '"INITIALIZED"');

  const geometry = record(body.route_geometry, "route_geometry");
  if (geometry.type !== "LineString") fail("route_geometry.type", '"LineString"');
  const coordinates = list(geometry.coordinates, "route_geometry.coordinates");
  if (coordinates.length < 2) fail("route_geometry.coordinates", "at least 2 coordinates");
  coordinates.forEach((pair, index) => {
    const path = `route_geometry.coordinates[${index}]`;
    const lngLat = list(pair, path);
    if (lngLat.length !== 2) fail(path, "a [lng, lat] pair");
    finite(lngLat[0], `${path}[0]`);
    finite(lngLat[1], `${path}[1]`);
  });

  finite(body.total_distance_m, "total_distance_m");
  finite(body.estimated_normal_time_sec, "estimated_normal_time_sec");
  finite(body.estimated_greenwave_time_sec, "estimated_greenwave_time_sec");
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
  return body as SimulationStartResponse;
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
        if (intersection.tti_seconds !== null) {
          finite(intersection.tti_seconds, `${path}.tti_seconds`);
        }
      });
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
  return value as SimulationStreamEvent;
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
