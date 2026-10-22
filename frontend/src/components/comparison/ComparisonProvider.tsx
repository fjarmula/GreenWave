"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createComparisonController } from "@/lib/comparison/comparison-controller";
import { simulationAdapter } from "@/lib/simulation-adapter";
import { simulationOperationSlot } from "@/lib/operation-slot";
import { createSimulationId } from "@/lib/simulation-id";
const Context = createContext<ReturnType<typeof createComparisonController> | null>(null);
export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() =>
    createComparisonController(simulationAdapter, simulationOperationSlot, createSimulationId),
  );
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
