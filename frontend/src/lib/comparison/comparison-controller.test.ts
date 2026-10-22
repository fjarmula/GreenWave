import { expect, it, vi } from "vitest";
import { createComparisonController } from "./comparison-controller";
import { createOperationSlot } from "@/lib/operation-slot";
import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import { request, route, tick, completed } from "./fixtures.test-support";
it("records sequentially with frozen settings and blocks a competing operation", async () => {
  let subscriber: SimulationStreamSubscriber;
  const starts: (typeof request)[] = [];
  const adapter: SimulationAdapter = {
    start: async (r) => {
      starts.push(r);
      return route(r.simulation_id, r.green_wave_mode);
    },
    stop: async () => {},
    subscribe: (_, s) => {
      subscriber = s;
      return () => {};
    },
  };
  const slot = createOperationSlot();
  const c = createComparisonController(adapter, slot, () => `id-${starts.length}`);
  const done = c.startComparison(request);
  await vi.waitFor(() => expect(starts).toHaveLength(1));
  expect(slot.acquire("live")).toBe(false);
  subscriber!.onTick(tick(1, "id-0"));
  subscriber!.onTerminal(completed(1, "id-0"));
  await vi.waitFor(() => expect(starts).toHaveLength(2));
  expect(starts[1]).toEqual({ ...starts[0], simulation_id: "id-1", green_wave_mode: "DISABLED" });
  subscriber!.onTick(tick(1, "id-1"));
  subscriber!.onTerminal(completed(1, "id-1"));
  await done;
  expect(c.getState().status).toBe("ready");
  expect(slot.acquire("live")).toBe(true);
});
it("cancel during a pending start stops late success and never starts mode two", async () => {
  let resolve!: (value: ReturnType<typeof route>) => void;
  const stop = vi.fn(async () => {});
  const start = vi.fn(
    () =>
      new Promise<ReturnType<typeof route>>((r) => {
        resolve = r;
      }),
  );
  const c = createComparisonController(
    { start, stop, subscribe: () => () => {} },
    createOperationSlot(),
    () => "late",
  );
  const done = c.startComparison(request);
  c.cancelComparison();
  resolve(route("late"));
  await done;
  expect(stop).toHaveBeenCalledWith("late");
  expect(start).toHaveBeenCalledTimes(1);
  expect(c.getState().pair).toBeNull();
  expect(c.getState().status).toBe("incomplete");
});
it("rejects a gapped recording and releases the operation only after stop succeeds", async () => {
  let subscriber!: SimulationStreamSubscriber;
  const slot = createOperationSlot();
  const stop = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const c = createComparisonController(
    {
      start: async (r) => route(r.simulation_id, r.green_wave_mode),
      subscribe: (_, s) => {
        subscriber = s;
        return () => {};
      },
      stop,
    },
    slot,
    () => "gap",
  );
  const done = c.startComparison(request);
  await vi.waitFor(() => expect(subscriber).toBeDefined());
  subscriber.onTick(tick(2, "gap"));
  await done;
  expect(c.getState().status).toBe("incomplete");
  expect(c.getState().pair).toBeNull();
  expect(slot.acquire("live")).toBe(false);
  c.cancelComparison();
  await vi.waitFor(() => expect(slot.getOwner()).toBeNull());
});
