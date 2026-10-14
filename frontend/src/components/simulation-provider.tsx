"use client";

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";

import {
  initialSimulationState,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from "@/lib/simulation-state";

const SimulationStateContext = createContext<SimulationState | null>(null);
const SimulationDispatchContext = createContext<Dispatch<SimulationAction> | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(simulationReducer, initialSimulationState);

  return (
    <SimulationStateContext value={state}>
      <SimulationDispatchContext value={dispatch}>{children}</SimulationDispatchContext>
    </SimulationStateContext>
  );
}

export function useSimulationState(): SimulationState {
  const state = useContext(SimulationStateContext);
  if (!state) throw new Error("useSimulationState must be used within SimulationProvider");
  return state;
}

export function useSimulationDispatch(): Dispatch<SimulationAction> {
  const dispatch = useContext(SimulationDispatchContext);
  if (!dispatch) throw new Error("useSimulationDispatch must be used within SimulationProvider");
  return dispatch;
}
