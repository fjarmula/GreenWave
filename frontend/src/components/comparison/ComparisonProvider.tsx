"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createLiveComparisonController } from "@/lib/comparison/live-comparison";
import { getFrontendConfig } from "@/lib/config";
import { simulationAdapter } from "@/lib/simulation-adapter";
import { simulationOperationSlot } from "@/lib/operation-slot";

type Controller = ReturnType<typeof createLiveComparisonController>;
const Context = createContext<Controller | null>(null);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => {
    const config = getFrontendConfig();
    return createLiveComparisonController(simulationAdapter, simulationOperationSlot, {
      staleAfterMilliseconds: config.staleAfterSeconds * 1000,
      lostAfterMilliseconds: config.lostAfterSeconds * 1000,
    });
  });
  return <Context value={controller}>{children}</Context>;
}

export function useComparison() {
  const controller = useContext(Context);
  if (!controller) throw new Error("ComparisonProvider is required");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return { controller, state };
}
