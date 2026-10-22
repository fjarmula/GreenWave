import type { SimulationAdapter } from "@/lib/simulation-adapter";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { diagnosticStore, type DiagnosticEntry, type Operation } from "./store";
type Store = Pick<typeof diagnosticStore, "record">;
type Transport = DiagnosticEntry["transport"];
export function observeOperation<T>(
  operation: Operation,
  transport: Transport,
  fn: () => Promise<T>,
  store: Store = diagnosticStore,
  now = () => performance.now(),
): Promise<T> {
  const began = now();
  store.record({ operation, transport, outcome: "pending" });
  const promise = fn();
  promise.then(
    () =>
      store.record({
        operation,
        transport,
        outcome: "success",
        durationMs: Math.max(0, now() - began),
      }),
    () =>
      store.record({
        operation,
        transport,
        outcome: "failure",
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
      observeOperation("stations", transport, () => adapter.listStations(), store),
    geocode: (q, signal) =>
      observeOperation("geocode", transport, () => adapter.geocode(q, signal), store),
    rank: (r, signal) =>
      observeOperation("ranking", transport, () => adapter.rank(r, signal), store),
  };
}
export function observeSimulation(
  adapter: SimulationAdapter,
  transport: Transport,
  store: Store = diagnosticStore,
  now = () => performance.now(),
): SimulationAdapter {
  return {
    start: (r) => observeOperation("start", transport, () => adapter.start(r), store, now),
    stop: (id) => observeOperation("stop", transport, () => adapter.stop(id), store, now),
    subscribe(id, subscriber) {
      const record = (operation: Operation, outcome: DiagnosticEntry["outcome"], tick?: number) =>
        store.record({ operation, transport, outcome, ...(tick === undefined ? {} : { tick }) });
      const off = adapter.subscribe(id, {
        onTick: (e) => {
          record("sse", "tick", e.tick);
          subscriber.onTick(e);
        },
        onItsDispatch: (e) => {
          record("its", "success", e.tick);
          subscriber.onItsDispatch(e);
        },
        onTerminal: (e) => {
          record(
            "sse",
            e.event_type === "SIMULATION_COMPLETED" ? "completed" : "cancelled",
            e.tick,
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
