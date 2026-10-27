export type FollowTarget = {
  following: boolean;
  canFollow?: boolean;
  resume(): void;
  showRoute(): void;
};
export type FollowSnapshot = { hasRoute: boolean; available: boolean; following: boolean };
export type FollowRegistry = ReturnType<typeof createFollowRegistry>;

/**
 * The routed maps of one workspace (two on Comparison), seen as one camera. Follow targets
 * fresh running members; route overview still drives every map after arrival or stale telemetry.
 */
export function createFollowRegistry() {
  const targets = new Map<string, FollowTarget>();
  const listeners = new Set<() => void>();
  let snapshot: FollowSnapshot = { hasRoute: false, available: false, following: false };
  const refresh = () => {
    const all = [...targets.values()];
    const hasRoute = all.length > 0;
    const active = all.filter((target) => target.canFollow !== false);
    const available = active.length > 0;
    const following = available && active.every((target) => target.following);
    if (
      hasRoute === snapshot.hasRoute &&
      available === snapshot.available &&
      following === snapshot.following
    )
      return;
    snapshot = { hasRoute, available, following };
    listeners.forEach((listener) => listener());
  };
  return {
    register(id: string, target: FollowTarget) {
      targets.set(id, target);
      refresh();
      return () => {
        if (targets.get(id) !== target) return;
        targets.delete(id);
        refresh();
      };
    },
    setFollowing(on: boolean) {
      targets.forEach((target) => {
        if (!on) target.showRoute();
        else if (target.canFollow !== false) target.resume();
      });
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
