import { observeDispatch } from "@/lib/diagnostics/observe-adapters";
import { getFrontendConfig, type FrontendConfig } from "@/lib/config";
import { createMockDispatchAdapter } from "@/lib/mock-dispatch";
import { createBackendDispatchAdapter } from "@/lib/transport/backend-dispatch-adapter";
import type {
  DispatchRankRequest,
  DispatchRankResponse,
  GeocodeResult,
  Station,
} from "@/types/telemetry";

/**
 * Transport boundary for incident dispatch: stations, address search and station
 * ranking. The backend ranks by the green-wave estimate; the mock only offers a
 * straight-line nearest station from the committed snapshot (no address search).
 * Domain failures reject with `SimulationAdapterError`; an aborted request rejects
 * with the platform `AbortError`.
 */
export type DispatchAdapter = {
  capabilities: { geocode: boolean; roadTimeRanking: boolean };
  listStations(): Promise<Station[]>;
  geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
  rank(request: DispatchRankRequest, signal?: AbortSignal): Promise<DispatchRankResponse>;
};

export function selectDispatchAdapter(config: FrontendConfig): DispatchAdapter {
  if (config.transport === "backend") {
    return createBackendDispatchAdapter(config.apiBaseUrl, {
      timeoutMilliseconds: config.startTimeoutMilliseconds,
    });
  }
  return createMockDispatchAdapter();
}

/** Module-level singleton chosen like `simulationAdapter` (`NEXT_PUBLIC_SIMULATION_TRANSPORT`). */
const config = getFrontendConfig();
const selectedAdapter = selectDispatchAdapter(config);
export const dispatchAdapter: DispatchAdapter =
  config.transport === "backend"
    ? selectedAdapter
    : observeDispatch(selectedAdapter, config.transport);
