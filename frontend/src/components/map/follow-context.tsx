"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createFollowRegistry,
  type FollowRegistry,
  type FollowSnapshot,
  type FollowTarget,
} from "@/lib/follow-registry";

const FollowContext = createContext<FollowRegistry | null>(null);
const NONE: FollowSnapshot = { hasRoute: false, available: false, following: false };
const noop = () => () => {};

/** Scopes the live maps of one workspace so a control outside the map can follow the vehicle. */
export function FollowProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createFollowRegistry);
  return <FollowContext.Provider value={registry}>{children}</FollowContext.Provider>;
}

export function useFollowControl(): FollowSnapshot & { setFollowing(on: boolean): void } {
  const registry = useContext(FollowContext);
  const snapshot = useSyncExternalStore(
    registry?.subscribe ?? noop,
    registry?.getSnapshot ?? (() => NONE),
    registry?.getSnapshot ?? (() => NONE),
  );
  return { ...snapshot, setFollowing: (on) => registry?.setFollowing(on) };
}

/** Registers this map's camera while `target` is set; null (no live route) unregisters it. */
export function useFollowTarget(target: FollowTarget | null): void {
  const registry = useContext(FollowContext);
  const id = useId();
  useEffect(() => {
    if (!registry || !target) return;
    return registry.register(id, target);
  }, [registry, id, target]);
}
