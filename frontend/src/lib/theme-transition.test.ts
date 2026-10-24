import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerThemeBarrier,
  transitionTheme,
  type ThemeTransitionEnv,
} from "@/lib/theme-transition";

type Callback = () => Promise<void>;

function fakeViewTransitions() {
  const callbacks: Callback[] = [];
  const skips: ReturnType<typeof vi.fn>[] = [];
  const startViewTransition = vi.fn((callback: Callback) => {
    callbacks.push(callback);
    const skipTransition = vi.fn();
    skips.push(skipTransition);
    return { finished: Promise.resolve(), skipTransition };
  });
  return { startViewTransition, callbacks, skips };
}

function env(overrides: Partial<ThemeTransitionEnv> = {}): ThemeTransitionEnv {
  return { reduceMotion: false, ...overrides };
}

const unregister: Array<() => void> = [];
function barrier(fn: Parameters<typeof registerThemeBarrier>[0]) {
  unregister.push(registerThemeBarrier(fn));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  unregister.splice(0).forEach((remove) => remove());
  vi.useRealTimers();
});

describe("transitionTheme", () => {
  it("applies directly without view transitions", () => {
    const apply = vi.fn();
    void transitionTheme(apply, "dark", env());
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("applies directly under reduced motion", () => {
    const vt = fakeViewTransitions();
    const apply = vi.fn();
    void transitionTheme(apply, "dark", env({ reduceMotion: true, ...vt }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(vt.startViewTransition).not.toHaveBeenCalled();
  });

  it("applies inside the view transition callback", async () => {
    const vt = fakeViewTransitions();
    const apply = vi.fn();
    void transitionTheme(apply, "dark", env(vt));
    expect(apply).not.toHaveBeenCalled();
    await vt.callbacks[0]();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("waits for registered barriers", async () => {
    const vt = fakeViewTransitions();
    const seen: string[] = [];
    barrier((next) => {
      seen.push(next);
      return new Promise((resolve) => setTimeout(resolve, 50));
    });
    void transitionTheme(vi.fn(), "dark", env(vt));
    let done = false;
    void vt.callbacks[0]().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(49);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(seen).toEqual(["dark"]);
  });

  it("does not wait past the barrier cap", async () => {
    const vt = fakeViewTransitions();
    barrier(() => new Promise(() => undefined));
    void transitionTheme(vi.fn(), "light", env({ ...vt, capMs: 300 }));
    let done = false;
    void vt.callbacks[0]().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("ignores a rejecting barrier", async () => {
    const vt = fakeViewTransitions();
    barrier(() => Promise.reject(new Error("style failed")));
    void transitionTheme(vi.fn(), "dark", env(vt));
    await expect(vt.callbacks[0]()).resolves.toBeUndefined();
  });

  it("skips the running transition when a new one starts", () => {
    const vt = fakeViewTransitions();
    void transitionTheme(vi.fn(), "dark", env(vt));
    void transitionTheme(vi.fn(), "light", env(vt));
    expect(vt.skips[0]).toHaveBeenCalledTimes(1);
    expect(vt.skips[1]).not.toHaveBeenCalled();
  });

  it("unregister removes the barrier", async () => {
    const vt = fakeViewTransitions();
    const removed = vi.fn(() => Promise.resolve());
    registerThemeBarrier(removed)();
    void transitionTheme(vi.fn(), "dark", env(vt));
    await vt.callbacks[0]();
    expect(removed).not.toHaveBeenCalled();
  });
});
