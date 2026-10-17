"use client";

import { useCallback, useEffect } from "react";
import { useSimulationDispatch, useSimulationState } from "@/components/simulation-provider";
import { simulationAdapter } from "@/lib/simulation-adapter";
import type { SimulationStartRequest } from "@/types/telemetry";

export function useSimulationStream() {
  const { simulationState, startRequest, routeData } = useSimulationState();
  const dispatch = useSimulationDispatch();

  const startSimulation = useCallback(
    async (request: SimulationStartRequest) => {
      const routeData = await simulationAdapter.start(request);
      dispatch({ type: "START", request, routeData });
    },
    [dispatch],
  );

  const stopSimulation = useCallback(() => {
    simulationAdapter.stop();
    dispatch({ type: "RESET" });
  }, [dispatch]);

  useEffect(() => {
    if (simulationState !== "RUNNING" || !startRequest || !routeData) return;
    return simulationAdapter.subscribe({
      onTick: (telemetry) => dispatch({ type: "TICK", telemetry }),
      onItsDispatch: () => undefined,
      onComplete: () => dispatch({ type: "FINISH" }),
    });
  }, [dispatch, routeData, simulationState, startRequest]);

  return { startSimulation, stopSimulation };
}
