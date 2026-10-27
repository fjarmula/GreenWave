import { describe, expect, it, vi } from "vitest";
import { createFollowRegistry, type FollowTarget } from "@/lib/follow-registry";

const target = (following: boolean): FollowTarget => ({
  following,
  resume: vi.fn(),
  showRoute: vi.fn(),
});

describe("createFollowRegistry", () => {
  it("is unavailable and inert with no live map", () => {
    const registry = createFollowRegistry();
    expect(registry.getSnapshot()).toEqual({ hasRoute: false, available: false, following: false });
    expect(() => registry.setFollowing(true)).not.toThrow();
  });

  it("follows only when every map follows, and drives every map", () => {
    const registry = createFollowRegistry();
    const a = target(true);
    const b = target(false);
    registry.register("a", a);
    registry.register("b", b);
    expect(registry.getSnapshot()).toEqual({ hasRoute: true, available: true, following: false });
    registry.setFollowing(true);
    expect(a.resume).toHaveBeenCalledOnce();
    expect(b.resume).toHaveBeenCalledOnce();
    registry.setFollowing(false);
    expect(a.showRoute).toHaveBeenCalledOnce();
    expect(b.showRoute).toHaveBeenCalledOnce();
  });

  it("recomputes and notifies once when a map unregisters", () => {
    const registry = createFollowRegistry();
    registry.register("a", target(true));
    const unregister = registry.register("b", target(false));
    const listener = vi.fn();
    registry.subscribe(listener);
    unregister();
    expect(registry.getSnapshot()).toEqual({ hasRoute: true, available: true, following: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps the snapshot identity until a value changes", () => {
    const registry = createFollowRegistry();
    registry.register("a", target(false));
    const first = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(first);
    registry.register("a", target(false));
    expect(registry.getSnapshot()).toBe(first);
  });

  it("replaces a re-registered map", () => {
    const registry = createFollowRegistry();
    registry.register("a", target(false));
    registry.register("a", target(true));
    expect(registry.getSnapshot()).toEqual({ hasRoute: true, available: true, following: true });
  });
});

it("keeps route overview available after one comparison member finishes", () => {
  const registry = createFollowRegistry();
  const finished = { ...target(false), canFollow: false };
  const running = { ...target(true), canFollow: true };
  registry.register("finished", finished);
  registry.register("running", running);
  expect(registry.getSnapshot()).toEqual({ hasRoute: true, available: true, following: true });
  registry.setFollowing(true);
  expect(finished.resume).not.toHaveBeenCalled();
  expect(running.resume).toHaveBeenCalledOnce();
  registry.setFollowing(false);
  expect(finished.showRoute).toHaveBeenCalledOnce();
  expect(running.showRoute).toHaveBeenCalledOnce();
});

it("retains Show route when telemetry is stale or the run has ended", () => {
  const registry = createFollowRegistry();
  registry.register("map", { ...target(true), canFollow: false });
  expect(registry.getSnapshot()).toEqual({ hasRoute: true, available: false, following: false });
});
