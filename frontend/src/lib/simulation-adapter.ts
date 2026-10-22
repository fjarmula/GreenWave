import { observeSimulation } from "@/lib/diagnostics/observe-adapters";
import { getFrontendConfig, type FrontendConfig } from "@/lib/config";
import { createMockSimulationAdapter } from "@/lib/mock-simulation-adapter";
import { createBackendSimulationAdapter } from "@/lib/transport/backend-simulation-adapter";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  ItsDispatchEvent,
  SimulationCancelledEvent,
  SimulationCompletedEvent,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "lost";

export type SimulationStreamSubscriber = {
  onTick: (event: SimulationTickEvent) => void;
  onItsDispatch: (event: ItsDispatchEvent) => void;
  /** Called once; the adapter closes the stream afterwards. */
  onTerminal: (event: SimulationCompletedEvent | SimulationCancelledEvent) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
  /** The stream is unrecoverable (simulation gone, retries exhausted) and closed. */
  onError: (error: SimulationErrorInfo) => void;
};

/**
 * Transport boundary for a simulation session. Components and the reducer
 * talk only to this interface; the mock and the backend (HTTP + SSE) adapters
 * implement it.
 */
export type SimulationAdapter = {
  /** Rejects with `SimulationAdapterError`. */
  start: (request: SimulationStartRequest) => Promise<SimulationStartResponse>;
  /** Returns an unsubscribe function that closes the stream. */
  subscribe: (simulationId: string, subscriber: SimulationStreamSubscriber) => () => void;
  stop: (simulationId: string) => Promise<void>;
};

export function selectSimulationAdapter(config: FrontendConfig): SimulationAdapter {
  if (config.transport === "backend") {
    return createBackendSimulationAdapter(config.apiBaseUrl, {
      startTimeoutMilliseconds: config.startTimeoutMilliseconds,
      reconnectAttemptLimit: config.reconnectAttemptLimit,
    });
  }
  return createMockSimulationAdapter();
}

/** Module-level singleton chosen by `NEXT_PUBLIC_SIMULATION_TRANSPORT` (default: mock, D22). */
export const simulationAdapter: SimulationAdapter = observeSimulation(
  selectSimulationAdapter(getFrontendConfig()),
  getFrontendConfig().transport,
);
