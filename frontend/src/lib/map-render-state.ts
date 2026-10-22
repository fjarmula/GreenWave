import { initialSimulationState, type SimulationState } from "./simulation-state";
/** Rendering setup must not reveal or relabel a run owned by another mode. */
export function selectMapState(state: SimulationState, live: boolean): SimulationState {
  return live ? state : initialSimulationState;
}
