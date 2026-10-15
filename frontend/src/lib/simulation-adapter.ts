import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTick,
} from "@/types/telemetry";

export type SimulationStreamSubscriber = {
  onTick: (telemetry: SimulationTick) => void;
  onComplete: () => void;
};

/**
 * Transport boundary for a simulation session. A backend WebSocket or SSE
 * implementation can replace the selected adapter without changing dashboard
 * components or simulation state.
 */
export type SimulationAdapter = {
  start: (request: SimulationStartRequest) => Promise<SimulationStartResponse>;
  subscribe: (subscriber: SimulationStreamSubscriber) => () => void;
  stop: () => void;
};

// Replace only this adapter selection when the backend stream is available.
export const simulationAdapter: SimulationAdapter = createMockSimulationAdapter();
