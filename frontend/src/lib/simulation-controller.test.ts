import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import {
  connectSimulationStream,
  requestSimulationStart,
  requestSimulationStop,
} from "@/lib/simulation-controller";
import {
  initialSimulationState,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from "@/lib/simulation-state";
import { SimulationAdapterError } from "@/lib/transport/errors";
import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const STALE_AFTER_MILLISECONDS = 3000;
const LOST_AFTER_MILLISECONDS = 15_000;

function request(simulationId: string): SimulationStartRequest {
  return {
    simulation_id: simulationId,
    origin: { lat: 50.06, lng: 19.95 },
    destination: { lat: 50.07, lng: 19.96 },
    traffic_density_multiplier: 1.5,
    enable_cascade_mode: true,
    playback_speed: 1,
  };
}

function response(simulationId: string): SimulationStartResponse {
  return {
    schema_version: "1.0",
    is_simulated: true,
    simulation_id: simulationId,
    status: "INITIALIZED",
    route_geometry: {
      type: "LineString",
      coordinates: [
        [19.95, 50.06],
        [19.96, 50.07],
      ],
    },
    total_distance_m: 1000,
    estimated_normal_time_sec: 200,
    estimated_greenwave_time_sec: 100,
    intersections_on_route: [],
    route_intersections: [],
    origin_snapped: { position: { lat: 50.06, lng: 19.95 }, snap_distance_m: 0 },
    destination_snapped: { position: { lat: 50.07, lng: 19.96 }, snap_distance_m: 0 },
  };
}

function tick(simulationId: string, n: number): SimulationTickEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_TICK",
    simulation_id: simulationId,
    tick: n,
    timestamp: "2026-10-25T14:32:10Z",
    ambulance: {
      id: "AMB-KRA-01",
      position: { lat: 50.06, lng: 19.95 },
      speed_kmh: 50,
      status: "EN_ROUTE",
    },
    kpi_metrics: { current_time_saved_sec: 0, total_time_elapsed_sec: n },
    intersections: [],
  };
}

type FakeAdapter = SimulationAdapter & {
  subscriptions: { simulationId: string; subscriber: SimulationStreamSubscriber; open: boolean }[];
  pendingStarts: {
    request: SimulationStartRequest;
    resolve: (value: SimulationStartResponse) => void;
    reject: (error: unknown) => void;
  }[];
  stops: string[];
};

function createFakeAdapter(): FakeAdapter {
  const adapter: FakeAdapter = {
    subscriptions: [],
    pendingStarts: [],
    stops: [],
    start: (startRequest) =>
      new Promise((resolve, reject) => {
        adapter.pendingStarts.push({ request: startRequest, resolve, reject });
      }),
    subscribe(simulationId, subscriber) {
      const subscription = { simulationId, subscriber, open: true };
      adapter.subscriptions.push(subscription);
      return () => {
        subscription.open = false;
      };
    },
    async stop(simulationId) {
      adapter.stops.push(simulationId);
    },
  };
  return adapter;
}

function createStore() {
  const store = {
    state: initialSimulationState as SimulationState,
    actions: [] as SimulationAction[],
    dispatch: (action: SimulationAction) => {
      store.actions.push(action);
      store.state = simulationReducer(store.state, action);
    },
  };
  return store;
}

async function startRunning(
  adapter: FakeAdapter,
  store: ReturnType<typeof createStore>,
  id: string,
) {
  const started = requestSimulationStart(adapter, request(id), store.dispatch, () => "unused");
  adapter.pendingStarts.at(-1)?.resolve(response(id));
  await started;
}

afterEach(() => vi.useRealTimers());

describe("requestSimulationStart", () => {
  it("dispatches START_REQUESTED then START_SUCCEEDED and resolves true", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    const started = requestSimulationStart(adapter, request("run-1"), store.dispatch, () => "x");
    expect(store.state.simulationState).toBe("STARTING");
    adapter.pendingStarts[0].resolve(response("run-1"));
    await expect(started).resolves.toBe(true);
    expect(store.state.simulationState).toBe("RUNNING");
  });

  it("never rejects: a network failure becomes START_FAILED", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    const started = requestSimulationStart(adapter, request("run-1"), store.dispatch, () => "x");
    adapter.pendingStarts[0].reject(
      new SimulationAdapterError({ kind: "network", message: "unreachable" }),
    );
    await expect(started).resolves.toBe(false);
    expect(store.state.simulationState).toBe("ERROR");
    expect(store.state.error).toMatchObject({ kind: "network", message: "unreachable" });
  });

  it("retries SIMULATION_ID_IN_USE once with a fresh id, then reports the error", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    const inUse = () =>
      new SimulationAdapterError({
        kind: "http",
        status: 409,
        code: "SIMULATION_ID_IN_USE",
        message: "in use",
      });
    const started = requestSimulationStart(
      adapter,
      request("run-1"),
      store.dispatch,
      () => "run-2",
    );
    adapter.pendingStarts[0].reject(inUse());
    await vi.waitFor(() => expect(adapter.pendingStarts).toHaveLength(2));
    expect(adapter.pendingStarts[1].request.simulation_id).toBe("run-2");
    expect(store.state.startRequest?.simulation_id).toBe("run-2");
    adapter.pendingStarts[1].reject(inUse());
    await expect(started).resolves.toBe(false);
    expect(adapter.pendingStarts).toHaveLength(2);
    expect(store.state.error?.code).toBe("SIMULATION_ID_IN_USE");
  });

  it("rapid start → back → start: run 1's late response never lands in run 2", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    const first = requestSimulationStart(adapter, request("run-1"), store.dispatch, () => "x");
    requestSimulationStop(adapter, "run-1", store.dispatch);
    const second = requestSimulationStart(adapter, request("run-2"), store.dispatch, () => "x");
    adapter.pendingStarts[1].resolve(response("run-2"));
    await second;
    adapter.pendingStarts[0].resolve(response("run-1"));
    await expect(first).resolves.toBe(false);
    expect(store.state.simulationState).toBe("RUNNING");
    expect(store.state.routeData?.simulation_id).toBe("run-2");
    // Run 1 started on the server after the user left it: it must not keep ticking there.
    expect(adapter.stops.filter((id) => id === "run-1")).toHaveLength(2);
    expect(adapter.stops).not.toContain("run-2");
  });

  it("does not retry SIMULATION_ID_IN_USE after the user went back or started another run", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    const first = requestSimulationStart(adapter, request("run-1"), store.dispatch, () => "retry");
    requestSimulationStop(adapter, "run-1", store.dispatch);
    const second = requestSimulationStart(adapter, request("run-2"), store.dispatch, () => "x");
    adapter.pendingStarts[0].reject(
      new SimulationAdapterError({
        kind: "http",
        status: 409,
        code: "SIMULATION_ID_IN_USE",
        message: "in use",
      }),
    );
    await expect(first).resolves.toBe(false);
    expect(adapter.pendingStarts.map((pending) => pending.request.simulation_id)).toEqual([
      "run-1",
      "run-2",
    ]);
    expect(store.state.simulationState).toBe("STARTING");
    expect(store.state.startRequest?.simulation_id).toBe("run-2");
    adapter.pendingStarts[1].resolve(response("run-2"));
    await expect(second).resolves.toBe(true);
  });
});

describe("requestSimulationStop", () => {
  it("resets immediately and asks the adapter to stop that run", () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    store.dispatch({ type: "START_REQUESTED", request: request("run-1") });
    requestSimulationStop(adapter, "run-1", store.dispatch);
    expect(store.state).toEqual(initialSimulationState);
    expect(adapter.stops).toEqual(["run-1"]);
  });

  it("swallows a stop failure (the run is already gone or unreachable)", async () => {
    const adapter = createFakeAdapter();
    adapter.stop = () => Promise.reject(new Error("down"));
    const store = createStore();
    requestSimulationStop(adapter, "run-1", store.dispatch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state).toEqual(initialSimulationState);
  });
});

describe("connectSimulationStream", () => {
  it("forwards stream callbacks for its run as reducer actions", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    connectSimulationStream(
      adapter,
      "run-1",
      store.dispatch,
      STALE_AFTER_MILLISECONDS,
      LOST_AFTER_MILLISECONDS,
    );
    const { subscriber, simulationId } = adapter.subscriptions[0];
    expect(simulationId).toBe("run-1");
    subscriber.onConnectionChange("open");
    subscriber.onTick(tick("run-1", 1));
    expect(store.state.connection).toBe("open");
    expect(store.state.liveTelemetry?.tick).toBe(1);
    subscriber.onError({ kind: "http", status: 404, code: "SIMULATION_NOT_FOUND", message: "x" });
    expect(store.state.simulationState).toBe("ERROR");
    expect(store.state.connection).toBe("lost");
  });

  it("cleanup unsubscribes and later callbacks are ignored", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    const cleanup = connectSimulationStream(
      adapter,
      "run-1",
      store.dispatch,
      STALE_AFTER_MILLISECONDS,
      LOST_AFTER_MILLISECONDS,
    );
    cleanup();
    expect(adapter.subscriptions[0].open).toBe(false);
    const before = store.actions.length;
    adapter.subscriptions[0].subscriber.onTick(tick("run-1", 1));
    expect(store.actions).toHaveLength(before);
  });

  it("is idempotent under Strict Mode double effects (connect → cleanup → connect)", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    const firstCleanup = connectSimulationStream(
      adapter,
      "run-1",
      store.dispatch,
      3000,
      LOST_AFTER_MILLISECONDS,
    );
    firstCleanup();
    connectSimulationStream(adapter, "run-1", store.dispatch, 3000, LOST_AFTER_MILLISECONDS);
    expect(adapter.subscriptions.filter((subscription) => subscription.open)).toHaveLength(1);
    adapter.subscriptions[0].subscriber.onTick(tick("run-1", 1));
    adapter.subscriptions[1].subscriber.onTick(tick("run-1", 1));
    expect(store.actions.filter((action) => action.type === "TICK")).toHaveLength(1);
  });

  it("marks an open but silent stream as reconnecting, and open again on the next event", async () => {
    vi.useFakeTimers();
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    connectSimulationStream(
      adapter,
      "run-1",
      store.dispatch,
      STALE_AFTER_MILLISECONDS,
      LOST_AFTER_MILLISECONDS,
    );
    const { subscriber } = adapter.subscriptions[0];
    subscriber.onConnectionChange("open");
    subscriber.onTick(tick("run-1", 1));
    vi.advanceTimersByTime(STALE_AFTER_MILLISECONDS - 1);
    expect(store.state.connection).toBe("open");
    vi.advanceTimersByTime(1);
    expect(store.state.connection).toBe("reconnecting");
    subscriber.onTick(tick("run-1", 2));
    expect(store.state.connection).toBe("open");
  });

  it("escalates a stream that stays silent to lost with a network error", async () => {
    vi.useFakeTimers();
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    connectSimulationStream(adapter, "run-1", store.dispatch, 3000, 15_000);
    expect(store.state.connection).toBe("connecting");
    vi.advanceTimersByTime(14_999);
    expect(store.state.simulationState).toBe("RUNNING");
    vi.advanceTimersByTime(1);
    expect(store.state.simulationState).toBe("ERROR");
    expect(store.state.connection).toBe("lost");
    expect(store.state.error).toMatchObject({ kind: "network" });
    expect(adapter.subscriptions[0].open).toBe(false);
  });

  it("any event restarts the silence timer", async () => {
    vi.useFakeTimers();
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    connectSimulationStream(adapter, "run-1", store.dispatch, 3000, 15_000);
    const { subscriber } = adapter.subscriptions[0];
    subscriber.onConnectionChange("open");
    vi.advanceTimersByTime(10_000);
    subscriber.onTick(tick("run-1", 1));
    vi.advanceTimersByTime(10_000);
    expect(store.state.simulationState).toBe("RUNNING");
  });

  it("SUPERSEDED ends the run as CANCELLED without restarting or stopping anything", async () => {
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    connectSimulationStream(adapter, "run-1", store.dispatch, 3000, 15_000);
    adapter.subscriptions[0].subscriber.onTerminal({
      schema_version: "1.0",
      is_simulated: true,
      event_type: "SIMULATION_CANCELLED",
      simulation_id: "run-1",
      tick: 3,
      timestamp: "2026-10-25T14:32:25Z",
      reason: "SUPERSEDED",
    });
    expect(store.state.simulationState).toBe("CANCELLED");
    expect(store.state.cancelReason).toBe("SUPERSEDED");
    expect(adapter.pendingStarts).toHaveLength(1);
    expect(adapter.stops).toEqual([]);
  });

  it("stops the stale watchdog on cleanup", async () => {
    vi.useFakeTimers();
    const adapter = createFakeAdapter();
    const store = createStore();
    await startRunning(adapter, store, "run-1");
    const cleanup = connectSimulationStream(
      adapter,
      "run-1",
      store.dispatch,
      3000,
      LOST_AFTER_MILLISECONDS,
    );
    adapter.subscriptions[0].subscriber.onConnectionChange("open");
    cleanup();
    const before = store.actions.length;
    vi.advanceTimersByTime(10_000);
    expect(store.actions).toHaveLength(before);
  });
});
