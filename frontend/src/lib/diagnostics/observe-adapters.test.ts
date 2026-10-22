import { expect, it, vi } from "vitest";
import { observeSimulation, observeDispatch } from "./observe-adapters";
import { createDiagnosticStore } from "./store";
import { request, route, tick } from "@/lib/comparison/fixtures.test-support";
import type { SimulationStreamSubscriber } from "@/lib/simulation-adapter";
it("preserves values, error identity, callback order and unsubscribe exactly once", async () => {
  const s = createDiagnosticStore();
  let subscriber!: SimulationStreamSubscriber;
  const cleanup = vi.fn();
  let now = 0;
  const adapter = observeSimulation(
    {
      start: async () => route(),
      stop: async () => {},
      subscribe: (_, v) => {
        subscriber = v;
        return cleanup;
      },
    },
    "backend",
    s,
    () => now,
  );
  const promise = adapter.start(request);
  now = 15;
  expect(await promise).toEqual(route());
  expect(s.getSnapshot().at(-1)?.durationMs).toBe(15);
  const order: number[] = [];
  const off = adapter.subscribe("pair", {
    onTick: (e) => order.push(e.tick),
    onItsDispatch: () => {},
    onTerminal: () => {},
    onConnectionChange: () => {},
    onError: () => {},
  });
  subscriber.onTick(tick(1));
  subscriber.onTick(tick(2));
  expect(order).toEqual([1, 2]);
  off();
  off();
  expect(cleanup).toHaveBeenCalledTimes(1);
  const error = new Error("private");
  let signal: AbortSignal | undefined;
  const d = observeDispatch(
    {
      capabilities: { geocode: true, roadTimeRanking: true },
      listStations: async () => [],
      geocode: (_, v) => {
        signal = v;
        return Promise.reject(error);
      },
      rank: () => Promise.reject(error),
    },
    "backend",
    s,
  );
  const abort = new AbortController();
  await expect(d.geocode("SECRET ADDRESS", abort.signal)).rejects.toBe(error);
  expect(signal).toBe(abort.signal);
  expect(JSON.stringify(s.getSnapshot())).not.toContain("SECRET");
});
it("diagnostic listener errors cannot interrupt stream delivery", async () => {
  const s = createDiagnosticStore();
  s.subscribe(() => {
    throw new Error("broken view");
  });
  let subscriber!: SimulationStreamSubscriber;
  const adapter = observeSimulation(
    {
      start: async () => route(),
      stop: async () => {},
      subscribe: (_, v) => {
        subscriber = v;
        return () => {};
      },
    },
    "mock",
    s,
  );
  const seen: number[] = [];
  adapter.subscribe("pair", {
    onTick: (e) => seen.push(e.tick),
    onItsDispatch: () => {},
    onTerminal: () => {},
    onConnectionChange: () => {},
    onError: () => {},
  });
  subscriber.onTick(tick(1));
  await Promise.resolve();
  subscriber.onTick(tick(2));
  expect(seen).toEqual([1, 2]);
});
