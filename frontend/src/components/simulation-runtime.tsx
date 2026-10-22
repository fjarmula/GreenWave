"use client";

import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from "react";
import { useSimulationDispatch, useSimulationState } from "@/components/simulation-provider";
import { simulationOperationSlot } from "@/lib/operation-slot";
import { simulationAdapter } from "@/lib/simulation-adapter";
import { createSimulationId } from "@/lib/simulation-id";
import {
  connectSimulationStream,
  requestRunStop,
  requestSimulationStart,
  requestSimulationStop,
} from "@/lib/simulation-controller";
import { getFrontendConfig } from "@/lib/config";
import type { SimulationStartRequest } from "@/types/telemetry";

const STALE_AFTER_MILLISECONDS = getFrontendConfig().staleAfterSeconds * 1000;
const LOST_AFTER_MILLISECONDS = getFrontendConfig().lostAfterSeconds * 1000;

function useRuntime() {
  const { simulationState, startRequest } = useSimulationState();
  const dispatch = useSimulationDispatch();
  const starting = useRef(false);
  const simulationId = startRequest?.simulation_id ?? null;
  const isStreaming = simulationState === "RUNNING";
  const isActive = simulationState === "STARTING" || isStreaming;

  /** Resolves true when the run started; failures are reported through the reducer. */
  const startSimulation = useCallback(
    async (request: SimulationStartRequest, replace = false) => {
      if (starting.current || simulationOperationSlot.getOwner() === "comparison") return false;
      if (isActive && (!replace || !isStreaming || !simulationId)) return false;
      starting.current = true;
      try {
        if (
          isActive &&
          simulationId &&
          !(await requestRunStop(simulationAdapter, simulationId, dispatch))
        )
          return false;
        simulationOperationSlot.release("live");
        if (!simulationOperationSlot.acquire("live")) return false;
        const started = await requestSimulationStart(
          simulationAdapter,
          request,
          dispatch,
          createSimulationId,
        );
        if (!started) simulationOperationSlot.release("live");
        return started;
      } finally {
        starting.current = false;
      }
    },
    [dispatch, isActive, isStreaming, simulationId],
  );

  const stopSimulation = useCallback(() => {
    requestSimulationStop(simulationAdapter, isActive ? simulationId : null, dispatch);
  }, [dispatch, isActive, simulationId]);

  /** The live view's Stop: the ended run stays on screen. */
  const stopRun = useCallback(() => {
    if (!isStreaming || !simulationId) return;
    void requestRunStop(simulationAdapter, simulationId, dispatch);
  }, [dispatch, isStreaming, simulationId]);

  useEffect(() => {
    if (!isActive && !starting.current) simulationOperationSlot.release("live");
  }, [isActive]);

  const prepareComparison = useCallback(async () => {
    if (starting.current || simulationState === "STARTING") return false;
    if (
      isStreaming &&
      simulationId &&
      !(await requestRunStop(simulationAdapter, simulationId, dispatch))
    )
      return false;
    simulationOperationSlot.release("live");
    return simulationOperationSlot.getOwner() === null;
  }, [dispatch, isStreaming, simulationId, simulationState]);

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

  return { startSimulation, stopSimulation, stopRun, prepareComparison };
}

const ActionsContext = createContext<ReturnType<typeof useRuntime> | null>(null);

export function SimulationRuntime({ children }: { children: ReactNode }) {
  const actions = useRuntime();
  return <ActionsContext value={actions}>{children}</ActionsContext>;
}

export function useSimulationActions() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("SimulationRuntime is required");
  return actions;
}
