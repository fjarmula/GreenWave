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

function sizedCamera(zoom = 12) {
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
  };
  const fit = vi.fn();
  const camera = createMapCamera(map, fit, () => {});
  const emit = (name: string, event: { originalEvent?: unknown }) => listeners.get(name)!(event);
  const setZoom = (next: number) => {
    currentZoom = next;
  };
  return { camera, fit, emit, setZoom };
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
