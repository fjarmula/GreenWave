import { describe, expect, it, vi } from "vitest";

import { createMapThemeSwap, type MapStyleTarget } from "@/components/map/map-theme-swap";

const STYLES = { light: "light.json", dark: "dark.json" };

function fakeMap() {
  let onLoad: (() => void) | null = null;
  let tiles = false;
  const target: MapStyleTarget = {
    setStyle: vi.fn(),
    onceStyleLoad: (callback) => (onLoad = callback),
    tilesReady: () => tiles,
    paint: vi.fn(),
  };
  return {
    target,
    loadStyle: () => onLoad?.(),
    setTiles: (ready: boolean) => (tiles = ready),
  };
}

async function settled(promise: Promise<void>) {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

describe("createMapThemeSwap", () => {
  it("resolves at once for the theme already applied", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    expect(await settled(swap.to("light"))).toBe(true);
    expect(map.target.setStyle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("resolves only after the new style and its tiles are ready", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    const pending = swap.to("dark");
    expect(map.target.setStyle).toHaveBeenCalledWith("dark.json");
    expect(await settled(pending)).toBe(false);
    map.loadStyle();
    expect(await settled(pending)).toBe(false);
    map.setTiles(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(await settled(pending)).toBe(true);
    expect(swap.applied()).toBe("dark");
    vi.useRealTimers();
  });

  it("paints the new style synchronously before resolving", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    const pending = swap.to("dark");
    map.loadStyle();
    expect(map.target.paint).not.toHaveBeenCalled();
    map.setTiles(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(await settled(pending)).toBe(true);
    expect(map.target.paint).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not restyle twice for a swap already in flight", () => {
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    void swap.to("dark");
    void swap.to("dark");
    expect(map.target.setStyle).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for tiles after the give-up window and paints anyway", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    const pending = swap.to("dark");
    map.loadStyle();
    await vi.advanceTimersByTimeAsync(1999);
    expect(await settled(pending)).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await settled(pending)).toBe(true);
    expect(map.target.paint).toHaveBeenCalledTimes(1);
    const tilesChecked = vi.spyOn(map.target, "tilesReady");
    await vi.advanceTimersByTimeAsync(500);
    expect(tilesChecked).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops polling and never paints once disposed", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const swap = createMapThemeSwap(map.target, STYLES, "light");
    void swap.to("dark");
    map.loadStyle();
    swap.dispose();
    const tilesChecked = vi.spyOn(map.target, "tilesReady");
    map.setTiles(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(tilesChecked).not.toHaveBeenCalled();
    expect(map.target.paint).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
