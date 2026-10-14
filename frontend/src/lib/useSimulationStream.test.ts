import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRoute, createMockTick, startMockStream } from "@/lib/useSimulationStream";
import type { SimulationStartRequest } from "@/types/telemetry";

const request: SimulationStartRequest = {
  simulation_id: "test",
  origin: { lat: 50.06, lng: 19.95 },
  destination: { lat: 50.07, lng: 19.96 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
};

afterEach(() => vi.useRealTimers());

describe("mock simulation stream", () => {
  it("emits once per second, finishes once and stops its timer", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onFinish = vi.fn();
    const route = { ...createMockRoute(request), estimated_greenwave_time_sec: 3 };
    startMockStream(request, route, onTick, onFinish);
    vi.advanceTimersByTime(999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2001);
    expect(onTick.mock.calls.map(([tick]) => tick.tick)).toEqual([1, 2, 3]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[2][0].ambulance.position).toEqual(request.destination);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it("cleans up without further ticks or completion", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onFinish = vi.fn();
    const stop = startMockStream(request, createMockRoute(request), onTick, onFinish);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("decreases TTI without negative values and respects the cascade setting", () => {
    const noCascade = { ...request, enable_cascade_mode: false };
    const route = createMockRoute(noCascade);
    expect(createMockTick(noCascade, route, 1).intersections[0].tti_seconds).toBe(27);
    const tick = createMockTick(noCascade, route, 50);
    expect(tick.intersections.every((signal) => signal.tti_seconds === 0)).toBe(true);
    expect(tick.intersections[1].state).toBe("NORMAL");
    expect(tick.intersections[1].is_active_corridor).toBe(false);
  });
});
