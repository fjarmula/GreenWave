import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import type { SimulationStartRequest, SimulationTick } from "@/types/telemetry";

const request: SimulationStartRequest = {
  simulation_id: "test",
  origin: { lat: 50.06, lng: 19.95 },
  destination: { lat: 50.07, lng: 19.96 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
};

afterEach(() => vi.useRealTimers());

describe("mock simulation stream", () => {
  it("emits once per second, finishes once and stops its timer", async () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onFinish = vi.fn();
    const adapter = createMockSimulationAdapter();
    const route = await adapter.start(request);
    route.estimated_greenwave_time_sec = 3;
    adapter.subscribe({ onTick, onComplete: onFinish });
    vi.advanceTimersByTime(999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2001);
    expect(onTick.mock.calls.map(([tick]) => tick.tick)).toEqual([1, 2, 3]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[2][0].ambulance.position).toEqual(request.destination);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it("stops without further ticks or completion", async () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onFinish = vi.fn();
    const adapter = createMockSimulationAdapter();
    await adapter.start(request);
    adapter.subscribe({ onTick, onComplete: onFinish });
    vi.advanceTimersByTime(1000);
    adapter.stop();
    vi.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("decreases TTI without negative values and respects the cascade setting", async () => {
    vi.useFakeTimers();
    const noCascade = { ...request, enable_cascade_mode: false };
    const adapter = createMockSimulationAdapter();
    await adapter.start(noCascade);
    const onTick = vi.fn();
    adapter.subscribe({ onTick, onComplete: vi.fn() });
    vi.advanceTimersByTime(1000);
    expect(onTick.mock.calls[0][0].intersections[0].tti_seconds).toBe(27);
    vi.advanceTimersByTime(49000);
    const tick = onTick.mock.calls.at(-1)?.[0] as SimulationTick | undefined;
    expect(tick).toBeDefined();
    expect(tick?.intersections.every((signal) => signal.tti_seconds === 0)).toBe(true);
    expect(tick?.intersections[1].state).toBe("NORMAL");
    expect(tick?.intersections[1].is_active_corridor).toBe(false);
  });
});
