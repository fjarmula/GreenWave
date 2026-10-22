"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { dispatchAdapter } from "@/lib/dispatch-adapter";
import { DEFAULT_DISPATCH_SETTINGS } from "@/lib/start-request";
import { useIncidentDispatch } from "@/lib/useIncidentDispatch";
import { useStations } from "@/lib/useStations";
import { toPreviousRun, nextPreviousRun, type PreviousRun } from "@/lib/previous-run";
import type { RunLabels } from "@/lib/scenario-state";
import { useSimulationState } from "@/components/simulation-provider";
import type { SimulationState } from "@/lib/simulation-state";

function useScenarioOwner() {
  const simulation = useSimulationState();
  const dispatch = useIncidentDispatch(dispatchAdapter);
  const stationState = useStations(dispatchAdapter);
  const [settings, setSettings] = useState(DEFAULT_DISPATCH_SETTINGS);
  const [runLabels, setRunLabels] = useState<RunLabels | null>(null);
  const [previousRun, setPreviousRun] = useState<PreviousRun | null>(null);
  const retainResult = (simulation: SimulationState) => {
    setPreviousRun((current) =>
      nextPreviousRun(
        current,
        simulation,
        runLabels?.origin.label ?? "Unknown station",
        runLabels?.destination.label ?? "Unknown incident",
      ),
    );
  };
  return {
    dispatch,
    ...stationState,
    settings,
    setSettings,
    runLabels,
    setRunLabels,
    previousRun:
      toPreviousRun(
        simulation,
        runLabels?.origin.label ?? "Unknown station",
        runLabels?.destination.label ?? "Unknown incident",
      ) ?? previousRun,
    retainResult,
  };
}

const ScenarioContext = createContext<ReturnType<typeof useScenarioOwner> | null>(null);
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const scenario = useScenarioOwner();
  return <ScenarioContext value={scenario}>{children}</ScenarioContext>;
}
export function useScenario() {
  const scenario = useContext(ScenarioContext);
  if (!scenario) throw new Error("ScenarioProvider is required");
  return scenario;
}
