import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import type { ConnectionStatus, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  ItsDispatchEvent,
  SimulationCancelledEvent,
  SimulationCompletedEvent,
  SimulationStartRequest,
  SimulationTickEvent,
} from "@/types/telemetry";

const request: SimulationStartRequest = {
  simulation_id: "test",
  origin: { lat: 50.06, lng: 19.95 },
  destination: { lat: 50.07, lng: 19.96 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 10,
};

afterEach(() => vi.useRealTimers());

function collect() {
  const ticks: SimulationTickEvent[] = [];
  const dispatches: ItsDispatchEvent[] = [];
  const completions: SimulationCompletedEvent[] = [];
  const cancellations: SimulationCancelledEvent[] = [];
  const connection: ConnectionStatus[] = [];
  const errors: SimulationErrorInfo[] = [];
  const subscriber: SimulationStreamSubscriber = {
    onTick: (event) => ticks.push(event),
    onItsDispatch: (event) => dispatches.push(event),
    onTerminal: (event) =>
      event.event_type === "SIMULATION_COMPLETED"
        ? completions.push(event)
        : cancellations.push(event),
    onConnectionChange: (status) => connection.push(status),
    onError: (error) => errors.push(error),
  };
  return { ticks, dispatches, completions, cancellations, connection, errors, subscriber };
}

describe("mock simulation start", () => {
  it("returns a v1 start response with sample route intersections on the route", async () => {
    const route = await createMockSimulationAdapter().start(request);
    expect(route).toMatchObject({
      schema_version: "1.0",
      is_simulated: true,
      simulation_id: "test",
      status: "INITIALIZED",
      intersections_on_route: ["INT-0360", "INT-0366"],
    });
    expect(route.route_intersections.map((intersection) => intersection.id)).toEqual([
      "INT-0360",
      "INT-0366",
    ]);
    expect(route.route_intersections.map((i) => i.distance_along_route_m)).toEqual([1480, 1632]);
    for (const intersection of route.route_intersections) {
      expect(intersection.position.lat).toBeGreaterThan(request.origin.lat);
      expect(intersection.position.lat).toBeLessThan(request.destination.lat);
    }
    expect(route.origin_snapped.position).toEqual(request.origin);
    expect(route.destination_snapped.position).toEqual(request.destination);
  });
});

describe("mock simulation stream", () => {
  it("emits one v1 tick per second advancing playback_speed simulated seconds", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(999);
    expect(events.ticks).toHaveLength(0);
    vi.advanceTimersByTime(2001);
    expect(events.ticks.map((tick) => tick.tick)).toEqual([1, 2, 3]);
    expect(events.ticks.map((tick) => tick.kpi_metrics.total_time_elapsed_sec)).toEqual([
      10, 20, 30,
    ]);
    expect(events.ticks[0]).toMatchObject({
      schema_version: "1.0",
      is_simulated: true,
      event_type: "SIMULATION_TICK",
      simulation_id: "test",
    });
  });

  it("dispatches ITS once when a sample intersection enters CLEARING, with its cascade group", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(60_000);
    expect(events.dispatches).toHaveLength(1);
    const [dispatch] = events.dispatches;
    expect(dispatch.payload.intersections_group).toEqual(["INT-0360", "INT-0366"]);
    expect(dispatch.payload.hold_duration_sec).toBeGreaterThanOrEqual(40);
    expect(dispatch.message_id).toBe("MSG-ITS-1");
    const tickOfDispatch = events.ticks.find((tick) => tick.tick === dispatch.tick);
    const cascaded = tickOfDispatch?.intersections.find((i) => i.id === "INT-0366");
    expect(cascaded).toMatchObject({ state: "CLEARING", is_cascade: true });
    expect(tickOfDispatch?.intersections[0]).toMatchObject({
      state: "CLEARING",
      is_cascade: false,
    });
  });

  it("never emits a fifth state and nulls TTI once an intersection is passed", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(60_000);
    const states = new Set(events.ticks.flatMap((tick) => tick.intersections.map((i) => i.state)));
    expect(
      [...states].every((state) =>
        ["NORMAL", "CLEARING", "PRIORITY_GREEN", "RECOVERY"].includes(state),
      ),
    ).toBe(true);
    expect(states.has("RECOVERY")).toBe(true);
    const recovering = events.ticks
      .flatMap((tick) => tick.intersections)
      .filter((intersection) => intersection.state === "RECOVERY");
    expect(recovering.every((intersection) => intersection.tti_seconds === null)).toBe(true);
  });

  it("each intersection enters CLEARING by its own TTI when cascade is off", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start({ ...request, enable_cascade_mode: false });
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(60_000);
    expect(events.dispatches.map((dispatch) => dispatch.payload.intersections_group)).toEqual([
      ["INT-0360"],
      ["INT-0366"],
    ]);
    const all = events.ticks.flatMap((tick) => tick.intersections);
    expect(all.some((intersection) => intersection.is_cascade)).toBe(false);
  });

  it("arrives, lets signals recover, completes once and stops its timer", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(120_000);
    expect(events.completions).toHaveLength(1);
    const lastTick = events.ticks.at(-1);
    expect(lastTick?.ambulance.status).toBe("ARRIVED");
    expect(lastTick?.ambulance.position).toEqual(request.destination);
    expect(lastTick?.intersections.every((i) => i.state === "NORMAL")).toBe(true);
    expect(events.completions[0]).toMatchObject({
      event_type: "SIMULATION_COMPLETED",
      simulation_id: "test",
      tick: lastTick?.tick,
    });
    const count = events.ticks.length;
    vi.advanceTimersByTime(10_000);
    expect(events.ticks).toHaveLength(count);
  });

  it("stops without further ticks or completion", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(1000);
    await adapter.stop("test");
    vi.advanceTimersByTime(10000);
    expect(events.ticks).toHaveLength(1);
    expect(events.completions).toHaveLength(0);
  });

  it("reports the stream open on subscribe", async () => {
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    expect(events.connection).toEqual(["open"]);
  });

  it("reports SIMULATION_NOT_FOUND for an unknown simulation id", async () => {
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("other", events.subscriber);
    expect(events.errors).toEqual([
      expect.objectContaining({ kind: "http", status: 404, code: "SIMULATION_NOT_FOUND" }),
    ]);
  });

  it("cancels a running simulation with SUPERSEDED when another one starts", async () => {
    vi.useFakeTimers();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    vi.advanceTimersByTime(2000);
    await adapter.start({ ...request, simulation_id: "next" });
    expect(events.cancellations).toEqual([
      expect.objectContaining({ simulation_id: "test", reason: "SUPERSEDED", tick: 2 }),
    ]);
    vi.advanceTimersByTime(5000);
    expect(events.ticks).toHaveLength(2);
  });

  it("stop cancels with STOPPED and ignores an unknown id", async () => {
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    const events = collect();
    adapter.subscribe("test", events.subscriber);
    await adapter.stop("other");
    expect(events.cancellations).toHaveLength(0);
    await adapter.stop("test");
    expect(events.cancellations).toEqual([
      expect.objectContaining({ reason: "STOPPED", simulation_id: "test" }),
    ]);
  });
});
