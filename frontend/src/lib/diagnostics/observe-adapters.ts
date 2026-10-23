import type { SimulationAdapter } from "@/lib/simulation-adapter";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import {
  diagnosticStore,
  type DiagnosticEntry,
  type Operation,
  type DiagnosticCapture,
} from "./store";
type Store = Pick<typeof diagnosticStore, "record">;
type Transport = DiagnosticEntry["transport"];
function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
function synthetic(
  transport: Transport,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): DiagnosticCapture | undefined {
  return transport === "mock"
    ? { method, path, ...(body === undefined ? {} : { requestBody: serialize(body) }) }
    : undefined;
}
export function observeOperation<T>(
  operation: Operation,
  transport: Transport,
  fn: () => Promise<T>,
  store: Store = diagnosticStore,
  now = () => performance.now(),
  capture?: DiagnosticCapture,
): Promise<T> {
  const began = now();
  store.record({ operation, transport, outcome: "pending", ...(capture ? { capture } : {}) });
  const promise = fn();
  promise.then(
    (value) =>
      store.record({
        operation,
        transport,
        outcome: "success",
        ...(capture ? { capture: { ...capture, responseBody: serialize(value) } } : {}),
        durationMs: Math.max(0, now() - began),
      }),
    () =>
      store.record({
        operation,
        transport,
        outcome: "failure",
        ...(capture ? { capture } : {}),
        durationMs: Math.max(0, now() - began),
      }),
  );
  return promise;
}
export function observeDispatch(
  adapter: DispatchAdapter,
  transport: Transport,
  store: Store = diagnosticStore,
): DispatchAdapter {
  return {
    capabilities: adapter.capabilities,
    listStations: () =>
      observeOperation(
        "stations",
        transport,
        () => adapter.listStations(),
        store,
        undefined,
        synthetic(transport, "/api/v1/stations"),
      ),
    geocode: (q, signal) =>
      observeOperation(
        "geocode",
        transport,
        () => adapter.geocode(q, signal),
        store,
        undefined,
        synthetic(transport, "/api/v1/geocode?" + new URLSearchParams({ q })),
      ),
    rank: (r, signal) =>
      observeOperation(
        "ranking",
        transport,
        () => adapter.rank(r, signal),
        store,
        undefined,
        synthetic(transport, "/api/v1/dispatch/rank", "POST", r),
      ),
  };
}
export function observeSimulation(
  adapter: SimulationAdapter,
  transport: Transport,
  store: Store = diagnosticStore,
  now = () => performance.now(),
): SimulationAdapter {
  return {
    start: (r) =>
      observeOperation(
        "start",
        transport,
        () => adapter.start(r),
        store,
        now,
        synthetic(transport, "/api/v1/simulation/start", "POST", r),
      ),
    stop: (id) =>
      observeOperation(
        "stop",
        transport,
        () => adapter.stop(id),
        store,
        now,
        synthetic(transport, `/api/v1/simulation/${id}/stop`, "POST"),
      ),
    subscribe(id, subscriber) {
      const record = (
        operation: Operation,
        outcome: DiagnosticEntry["outcome"],
        tick?: number,
        body?: unknown,
      ) =>
        store.record({
          operation,
          transport,
          outcome,
          ...(tick === undefined ? {} : { tick }),
          ...(transport === "mock" && body !== undefined
            ? {
                capture: {
                  method: "GET",
                  path: `/api/v1/simulation/${id}/stream`,
                  responseBody: serialize(body),
                },
              }
            : {}),
        });
      const off = adapter.subscribe(id, {
        onTick: (e) => {
          record("sse", "tick", e.tick, e);
          subscriber.onTick(e);
        },
        onItsFeedback: (e) => {
          record("its-feedback", "success", e.tick, e);
          subscriber.onItsFeedback(e);
        },
        onItsDispatch: (e) => {
          record("its", "success", e.tick, e);
          subscriber.onItsDispatch(e);
        },
        onTerminal: (e) => {
          record(
            "sse",
            e.event_type === "SIMULATION_COMPLETED" ? "completed" : "cancelled",
            e.tick,
            e,
          );
          subscriber.onTerminal(e);
        },
        onConnectionChange: (status) => {
          record("sse", status);
          subscriber.onConnectionChange(status);
        },
        onError: (e) => {
          record("sse", "failure");
          subscriber.onError(e);
        },
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        off();
        record("sse", "closed");
      };
    },
  };
}
