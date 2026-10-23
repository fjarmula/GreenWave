import { describe, expect, it, vi } from "vitest";
import { createLiveComparisonController } from "./live-comparison";
import { completed, route, tick } from "./fixtures.test-support";
import { createOperationSlot } from "@/lib/operation-slot";
import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import type { ComparisonStartRequest } from "@/types/telemetry";
import { cancelledEventExample } from "@/lib/transport/__fixtures__/architecture-examples";

const request: ComparisonStartRequest = {
  enabled_simulation_id: "pair-e",
  disabled_simulation_id: "pair-d",
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0621, lng: 19.9248 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 10,
  vehicle_type: "AMBULANCE",
};
const timing = { staleAfterMilliseconds: 3000, lostAfterMilliseconds: 15000 };

function fakeAdapter() {
  const streams = new Map<string, SimulationStreamSubscriber>();
  const adapter: SimulationAdapter = {
    start: async () => {
      throw new Error("not used");
    },
    startComparison: vi.fn(async () => ({
      schema_version: "1.0" as const,
      is_simulated: true as const,
      enabled: route("pair-e", "ENABLED"),
      disabled: route("pair-d", "DISABLED"),
    })),
    subscribe: (id, subscriber) => {
      streams.set(id, subscriber);
      subscriber.onConnectionChange("open");
      return () => streams.delete(id);
    },
    stop: vi.fn(async () => {}),
  };
  const stream = (id: string) => {
    const subscriber = streams.get(id);
    if (!subscriber) throw new Error(`no stream for ${id}`);
    return subscriber;
  };
  const cancel = (id: string, reason: "STOPPED" | "SUPERSEDED", n: number) =>
    stream(id).onTerminal({ ...cancelledEventExample, simulation_id: id, tick: n, reason });
  return { adapter, streams, stream, cancel };
}

async function running() {
  const fake = fakeAdapter();
  const slot = createOperationSlot();
  const controller = createLiveComparisonController(fake.adapter, slot, timing);
  await controller.start(request);
  return { ...fake, slot, controller };
}

describe("live comparison controller", () => {
  it("starts both runs through one comparison start and owns the slot", async () => {
    const { controller, adapter, slot, streams } = await running();
    expect(adapter.startComparison).toHaveBeenCalledWith(request);
    expect(slot.getOwner()).toBe("comparison");
    const state = controller.getState();
    expect(state.status).toBe("running");
    expect(state.runs.ENABLED.simulationState).toBe("RUNNING");
    expect(state.runs.DISABLED.simulationState).toBe("RUNNING");
    expect(state.runs.DISABLED.startRequest?.green_wave_mode).toBe("DISABLED");
    expect([...streams.keys()].sort()).toEqual(["pair-d", "pair-e"]);
  });

  it("refuses to start while another operation owns the slot", async () => {
    const fake = fakeAdapter();
    const slot = createOperationSlot();
    slot.acquire("live");
    const controller = createLiveComparisonController(fake.adapter, slot, timing);
    await controller.start(request);
    expect(fake.adapter.startComparison).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ status: "error" });
    expect(controller.getState().reason).toMatch(/active simulation/);
  });

  it("collects signals given priority from Green Wave ticks only", async () => {
    const { controller, stream } = await running();
    const green = {
      ...tick(1, "pair-e"),
      intersections: tick(1).intersections.map((i) => ({ ...i, state: "PRIORITY_GREEN" as const })),
    };
    stream("pair-e").onTick(green);
    stream("pair-d").onTick({
      ...tick(1, "pair-d"),
      intersections: green.intersections,
    });
    stream("pair-e").onTick({ ...green, tick: 2 });
    expect(controller.getState().priorityIds.sort()).toEqual(["INT-0360", "INT-0366"]);
  });

  it("finishes and releases the slot after both terminals", async () => {
    const { controller, stream, slot } = await running();
    stream("pair-e").onTick(tick(1, "pair-e"));
    stream("pair-d").onTick(tick(1, "pair-d"));
    stream("pair-e").onTerminal(completed(1, "pair-e"));
    expect(controller.getState().status).toBe("running");
    expect(slot.getOwner()).toBe("comparison");
    stream("pair-d").onTerminal(completed(1, "pair-d"));
    expect(controller.getState().status).toBe("finished");
    expect(slot.getOwner()).toBeNull();
  });

  it("reports a replaced comparison", async () => {
    const { controller, cancel, slot } = await running();
    cancel("pair-e", "SUPERSEDED", 0);
    cancel("pair-d", "SUPERSEDED", 0);
    expect(controller.getState()).toMatchObject({
      status: "cancelled",
      reason: "Comparison replaced by another simulation",
    });
    expect(slot.getOwner()).toBeNull();
  });

  it("stops through the Green Wave id and finishes with the live run cancelled", async () => {
    const { controller, stream, cancel, adapter } = await running();
    stream("pair-e").onTick(tick(1, "pair-e"));
    stream("pair-d").onTick(tick(1, "pair-d"));
    stream("pair-e").onTerminal(completed(1, "pair-e"));
    await controller.stop();
    expect(adapter.stop).toHaveBeenCalledWith("pair-e");
    cancel("pair-d", "STOPPED", 1);
    const state = controller.getState();
    expect(state.status).toBe("finished");
    expect(state.runs.ENABLED.simulationState).toBe("FINISHED");
    expect(state.runs.DISABLED.simulationState).toBe("CANCELLED");
  });

  it("reports a failed start and releases the slot", async () => {
    const fake = fakeAdapter();
    vi.mocked(fake.adapter.startComparison).mockRejectedValueOnce(
      Object.assign(new Error("No route"), { kind: "http", status: 422 }),
    );
    const slot = createOperationSlot();
    const controller = createLiveComparisonController(fake.adapter, slot, timing);
    await controller.start(request);
    expect(controller.getState()).toMatchObject({ status: "error", reason: "No route" });
    expect(slot.getOwner()).toBeNull();
  });

  it("reset returns to idle, closes both streams and frees the slot", async () => {
    const { controller, streams, slot, adapter } = await running();
    controller.reset();
    expect(controller.getState().status).toBe("idle");
    expect(streams.size).toBe(0);
    expect(slot.getOwner()).toBeNull();
    expect(adapter.stop).toHaveBeenCalledWith("pair-e");
  });

  it("notifies subscribers on change", async () => {
    const fake = fakeAdapter();
    const controller = createLiveComparisonController(fake.adapter, createOperationSlot(), timing);
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.start(request);
    expect(listener).toHaveBeenCalled();
  });
});

describe("live comparison stop", () => {
  it("marks the pair as stopping until the stop is answered", async () => {
    const { controller, cancel } = await running();
    const pending = controller.stop();
    expect(controller.getState().stopping).toBe(true);
    await pending;
    cancel("pair-e", "STOPPED", 1);
    cancel("pair-d", "STOPPED", 1);
    expect(controller.getState()).toMatchObject({ status: "finished", stopping: false });
  });

  it("reports a failed stop and keeps running", async () => {
    const { controller, adapter } = await running();
    vi.mocked(adapter.stop).mockRejectedValueOnce(new Error("offline"));
    await controller.stop();
    expect(controller.getState()).toMatchObject({
      status: "running",
      stopping: false,
      reason: "Could not stop: offline",
    });
  });
});
