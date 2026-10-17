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
import { parseErrorResponse, parseStartResponse, parseStreamEvent } from "@/lib/transport/validate";

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
      "a route intersection without a position",
      (c: Record<string, unknown>) =>
        delete record((c.route_intersections as unknown[])[0]).position,
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
