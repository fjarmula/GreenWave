import { expect, it, vi } from "vitest";
import { createMapCamera } from "@/lib/camera-policy";
it("follows the displayed point, freezes stale updates and removes listeners", () => {
  const listeners = new Map<string, (e: { originalEvent?: unknown }) => void>();
  const jumpTo = vi.fn();
  let width = 0;
  const map = {
    on: (name: string, fn: (e: { originalEvent?: unknown }) => void) => {
      listeners.set(name, fn);
    },
    off: (name: string) => {
      listeners.delete(name);
    },
    getZoom: () => 17,
    getContainer: () => ({ clientWidth: width, clientHeight: 200 }),
    jumpTo,
    easeTo: vi.fn(),
    stop: vi.fn(),
  };
  const fit = vi.fn();
  const camera = createMapCamera(map, fit, () => {});
  expect(fit).not.toHaveBeenCalled();
  width = 320;
  listeners.get("resize")!({});
  expect(fit).toHaveBeenCalledTimes(1);
  listeners.get("zoomend")!({ originalEvent: {} });
  camera.display([19, 50], true);
  expect(jumpTo).toHaveBeenLastCalledWith({ center: [19, 50], bearing: 0, pitch: 0 });
  camera.display([20, 51], false);
  expect(jumpTo).toHaveBeenCalledTimes(1);
  listeners.get("dragstart")!({ originalEvent: {} });
  camera.display([21, 52], true);
  expect(jumpTo).toHaveBeenCalledTimes(1);
  camera.dispose();
  expect(listeners.size).toBe(0);
  camera.display([22, 53], true);
  expect(jumpTo).toHaveBeenCalledTimes(1);
});

function sizedCamera(zoom = 12, reduceMotion = false) {
  const listeners = new Map<string, (e: { originalEvent?: unknown }) => void>();
  let currentZoom = zoom;
  const map = {
    on: (name: string, fn: (e: { originalEvent?: unknown }) => void) => {
      listeners.set(name, fn);
    },
    off: (name: string) => {
      listeners.delete(name);
    },
    getZoom: () => currentZoom,
    getContainer: () => ({ clientWidth: 320, clientHeight: 200 }),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    stop: vi.fn(),
  };
  const fit = vi.fn();
  const changed = vi.fn();
  const camera = createMapCamera(map, fit, changed, () => reduceMotion);
  const emit = (name: string, event: { originalEvent?: unknown }) => listeners.get(name)!(event);
  const setZoom = (next: number) => {
    currentZoom = next;
  };
  return { camera, map, changed, fit, emit, setZoom, jumpTo: map.jumpTo };
}

it("reframe refits in overview", () => {
  const { camera, fit } = sizedCamera();
  expect(fit).toHaveBeenCalledTimes(1);
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(2);
});

it("reframe is ignored after a user move", () => {
  const { camera, fit, emit } = sizedCamera();
  emit("dragstart", { originalEvent: {} });
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(1);
});

it("reframe is ignored after a user zoom that stays in overview", () => {
  const { camera, fit, emit } = sizedCamera();
  emit("zoomend", { originalEvent: {} });
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(1);
});

it("a programmatic move keeps reframe enabled", () => {
  const { camera, fit, emit } = sizedCamera();
  emit("zoomend", {});
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(2);
});

it("show route re-enables reframe", () => {
  const { camera, fit, emit } = sizedCamera();
  emit("dragstart", { originalEvent: {} });
  camera.showRoute();
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(3);
});

it("reframe is ignored while following", () => {
  const { camera, fit, emit, setZoom } = sizedCamera();
  setZoom(17);
  emit("zoomend", { originalEvent: {} });
  camera.reframe();
  expect(fit).toHaveBeenCalledTimes(1);
});

it("Follow vehicle eases to street level without displayed frames cancelling the zoom", () => {
  const { camera, map, emit } = sizedCamera();
  camera.display([19, 50], true);
  camera.resume();
  expect(map.easeTo).toHaveBeenCalledWith(
    { center: [19, 50], zoom: 17, bearing: 0, pitch: 0, duration: 600 },
    expect.any(Object),
  );
  camera.display([20, 51], true);
  emit("zoomend", {});
  emit("moveend", {}); // a preceding route-fit or user gesture, not our transition
  expect(map.jumpTo).not.toHaveBeenCalled();
  emit("moveend", map.easeTo.mock.calls[0][1]);
  camera.display([20, 51], true);
  expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [20, 51], bearing: 0, pitch: 0 });
});
it("preserves a closer zoom and respects reduced motion", () => {
  const { camera, map } = sizedCamera(18, true);
  camera.display([19, 50], true);
  camera.resume();
  expect(map.easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 18, duration: 0 }),
    expect.any(Object),
  );
});
it("ignores late completion after a user pan", () => {
  const { camera, map, emit, changed } = sizedCamera();
  camera.display([19, 50], true);
  camera.resume();
  emit("dragstart", { originalEvent: {} });
  emit("moveend", map.easeTo.mock.calls[0][1]);
  camera.display([20, 51], true);
  expect(changed).toHaveBeenLastCalledWith("suspended");
  expect(map.jumpTo).not.toHaveBeenCalled();
});
it("does not write centers during user zoom and leaves follow below zoom 16", () => {
  const { camera, map, emit, setZoom } = sizedCamera();
  camera.display([19, 50], true);
  camera.resume();
  emit("zoomstart", { originalEvent: {} });
  camera.display([20, 51], true);
  setZoom(15);
  emit("zoomend", { originalEvent: {} });
  camera.display([21, 52], true);
  expect(map.jumpTo).not.toHaveBeenCalled();
});
it("wheel entry into detail survives the gesture's trailing moveend", async () => {
  const { camera, map, emit, setZoom } = sizedCamera();
  camera.display([19, 50], true);
  setZoom(16.7);
  emit("zoomend", { originalEvent: {} });
  emit("moveend", { originalEvent: {} });
  camera.display([20, 51], true);
  await Promise.resolve();
  expect(map.easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 16.7 }),
    expect.any(Object),
  );
  expect(map.jumpTo).not.toHaveBeenCalled();
});
it("does not follow stale or ended points and freezes a transition on pause", () => {
  const { camera, map, emit } = sizedCamera();
  camera.display([19, 50], false);
  camera.resume();
  expect(map.easeTo).not.toHaveBeenCalled();
  camera.display([19, 50], true);
  camera.resume();
  camera.pause();
  emit("moveend", map.easeTo.mock.calls[0][1]);
  expect(map.stop).toHaveBeenCalled();
  expect(map.jumpTo).not.toHaveBeenCalled();
});
it("Show route and dispose prevent pending transitions from resuming follow", () => {
  const { camera, map, fit, emit } = sizedCamera();
  camera.display([19, 50], true);
  camera.resume();
  camera.showRoute();
  emit("moveend", map.easeTo.mock.calls[0][1]);
  expect(map.jumpTo).not.toHaveBeenCalled();
  expect(fit).toHaveBeenCalledTimes(2);
  camera.dispose();
  camera.resume();
  camera.showRoute();
  expect(map.easeTo).toHaveBeenCalledTimes(1);
  expect(fit).toHaveBeenCalledTimes(2);
});

it("a gesture interrupting an ease does not snap to its destination before dragstart", () => {
  const { camera, map, emit } = sizedCamera();
  camera.display([19, 50], true);
  camera.resume();
  // MapLibre stops the ease and emits its moveend before announcing the user gesture.
  emit("moveend", map.easeTo.mock.calls[0][1]);
  expect(map.jumpTo).not.toHaveBeenCalled();
  emit("dragstart", { originalEvent: {} });
  camera.display([20, 51], true);
  expect(map.jumpTo).not.toHaveBeenCalled();
});

it("waits for the wheel handler to return before starting an ease", async () => {
  const { camera, map, emit, setZoom } = sizedCamera();
  camera.display([19, 50], true);
  setZoom(17);
  emit("zoomend", { originalEvent: {} });
  expect(map.easeTo).not.toHaveBeenCalled();
  camera.display([20, 51], true);
  expect(map.jumpTo).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(map.easeTo).toHaveBeenCalledOnce();
});

it("one Follow click wins over the interrupted wheel gesture's trailing zoomend", () => {
  const { camera, map, emit, changed } = sizedCamera(14);
  camera.display([19, 50], true);
  emit("zoomstart", { originalEvent: {} });
  // Stopping a wheel animation can synchronously finish its user-originated zoom.
  map.stop.mockImplementationOnce(() => emit("zoomend", { originalEvent: {} }));
  camera.resume();
  expect(changed).toHaveBeenLastCalledWith("following");
  emit("moveend", map.easeTo.mock.calls[0][1]);
  camera.display([20, 51], true);
  expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [20, 51], bearing: 0, pitch: 0 });
});

it("Show route wins over a user zoom completed while fitting the route", async () => {
  const { camera, map, fit, emit, setZoom, changed } = sizedCamera(17);
  camera.display([19, 50], true);
  emit("zoomstart", { originalEvent: {} });
  setZoom(17.5);
  map.stop.mockImplementationOnce(() => emit("zoomend", { originalEvent: {} }));
  fit.mockImplementationOnce(() => {
    map.stop();
  });
  camera.showRoute();
  expect(changed).toHaveBeenLastCalledWith("overview");
  await Promise.resolve();
  expect(map.easeTo).not.toHaveBeenCalled();
});
