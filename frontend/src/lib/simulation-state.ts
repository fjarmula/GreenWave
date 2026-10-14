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
      itsLogs: string[];
    }
  | {
      simulationState: "RUNNING" | "FINISHED";
      startRequest: SimulationStartRequest;
      routeData: SimulationStartResponse;
      liveTelemetry: SimulationTick | null;
      itsLogs: string[];
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
  itsLogs: [],
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
        itsLogs: ["[MOCK] Simulation initialized; synthetic route and estimates loaded"],
      };
    case "TICK":
      return state.simulationState === "RUNNING"
        ? {
            ...state,
            liveTelemetry: action.telemetry,
            itsLogs: [
              ...state.itsLogs,
              `[MOCK ITS] Tick ${action.telemetry.tick} · ${action.telemetry.intersections.filter((intersection) => intersection.is_active_corridor).length} sample corridor signals · telemetry received`,
            ].slice(-20),
          }
        : state;
    case "FINISH":
      return state.simulationState === "RUNNING"
        ? { ...state, simulationState: "FINISHED" }
        : state;
    case "RESET":
      return initialSimulationState;
  }
}
