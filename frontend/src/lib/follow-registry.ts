export type FollowTarget = { following: boolean; resume(): void; showRoute(): void };
export type FollowSnapshot = { available: boolean; following: boolean };
export type FollowRegistry = ReturnType<typeof createFollowRegistry>;

/**
 * The live maps of one workspace (two on Comparison), seen as one camera: it follows only when
 * every map follows, and a change drives every map.
 */
export function createFollowRegistry() {
  const targets = new Map<string, FollowTarget>();
  const listeners = new Set<() => void>();
  let snapshot: FollowSnapshot = { available: false, following: false };
  const refresh = () => {
    const all = [...targets.values()];
    const available = all.length > 0;
    const following = available && all.every((target) => target.following);
    if (available === snapshot.available && following === snapshot.following) return;
    snapshot = { available, following };
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
      targets.forEach((target) => (on ? target.resume() : target.showRoute()));
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
