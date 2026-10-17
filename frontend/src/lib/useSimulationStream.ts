"use client";

import { useCallback, useEffect } from "react";
import { useSimulationDispatch, useSimulationState } from "@/components/simulation-provider";
import { simulationAdapter } from "@/lib/simulation-adapter";
import {
  connectSimulationStream,
  requestSimulationStart,
  requestSimulationStop,
} from "@/lib/simulation-controller";
import { getFrontendConfig } from "@/lib/config";
import type { SimulationStartRequest } from "@/types/telemetry";

const STALE_AFTER_MILLISECONDS = getFrontendConfig().staleAfterSeconds * 1000;
const LOST_AFTER_MILLISECONDS = getFrontendConfig().lostAfterSeconds * 1000;

export function useSimulationStream() {
  const { simulationState, startRequest } = useSimulationState();
  const dispatch = useSimulationDispatch();
  const simulationId = startRequest?.simulation_id ?? null;
  const isStreaming = simulationState === "RUNNING";
  const isActive = simulationState === "STARTING" || isStreaming;

  /** Resolves true when the run started; failures are reported through the reducer. */
  const startSimulation = useCallback(
    (request: SimulationStartRequest) =>
      requestSimulationStart(simulationAdapter, request, dispatch, () => crypto.randomUUID()),
    [dispatch],
  );

  const stopSimulation = useCallback(() => {
    requestSimulationStop(simulationAdapter, isActive ? simulationId : null, dispatch);
  }, [dispatch, isActive, simulationId]);

  useEffect(() => {
    if (!isStreaming || !simulationId) return;
    return connectSimulationStream(
      simulationAdapter,
      simulationId,
      dispatch,
      STALE_AFTER_MILLISECONDS,
      LOST_AFTER_MILLISECONDS,
    );
  }, [dispatch, isStreaming, simulationId]);

  return { startSimulation, stopSimulation };
}
