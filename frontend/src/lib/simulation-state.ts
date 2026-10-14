import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTick,
} from "@/types/telemetry";

export type SimulationState =
  | {
      simulationState: "SETUP";
      startRequest: null;
      routeData: null;
      liveTelemetry: null;
    }
  | {
      simulationState: "RUNNING" | "FINISHED";
      startRequest: SimulationStartRequest;
      routeData: SimulationStartResponse;
      liveTelemetry: SimulationTick | null;
    };

export type SimulationAction =
  | { type: "START"; request: SimulationStartRequest; routeData: SimulationStartResponse }
  | { type: "TICK"; telemetry: SimulationTick }
  | { type: "FINISH" }
  | { type: "RESET" };

export const initialSimulationState: SimulationState = {
  simulationState: "SETUP",
  startRequest: null,
  routeData: null,
  liveTelemetry: null,
};

export function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  switch (action.type) {
    case "START":
      return {
        simulationState: "RUNNING",
        startRequest: action.request,
        routeData: action.routeData,
        liveTelemetry: null,
      };
    case "TICK":
      return state.simulationState === "RUNNING"
        ? { ...state, liveTelemetry: action.telemetry }
        : state;
    case "FINISH":
      return state.simulationState === "RUNNING"
        ? { ...state, simulationState: "FINISHED" }
        : state;
    case "RESET":
      return initialSimulationState;
  }
}
