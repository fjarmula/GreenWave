/** User-facing English copy for simulation states and errors. */
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  CancelReason,
  ErrorCode,
  KpiMetrics,
  SimulationStartResponse,
} from "@/types/telemetry";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ORIGIN_OFF_NETWORK: "Origin is not on the simulated road network",
  DESTINATION_OFF_NETWORK: "Destination is not on the simulated road network",
  NO_ROUTE: "No drivable route between these points",
  // Reached only after the automatic retry with a fresh id also collided.
  SIMULATION_ID_IN_USE: "The simulation id was already in use twice; please initialize again",
  SIMULATION_NOT_FOUND: "Simulation no longer exists",
};

export function describeSimulationError(error: SimulationErrorInfo, apiBaseUrl: string): string {
  if (error.kind === "network") return `Simulation backend unreachable at ${apiBaseUrl}`;
  if (error.code) return ERROR_MESSAGES[error.code];
  return error.status
    ? `The simulation backend rejected the request (HTTP ${error.status})`
    : "The simulation backend sent an unexpected response";
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  lost: "Connection lost",
};

export function connectionLabel(status: ConnectionStatus): string {
  return CONNECTION_LABELS[status];
}

const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  STOPPED: "Stopped",
  SUPERSEDED: "Superseded by another dispatch",
};

export function cancelReasonLabel(reason: CancelReason): string {
  return CANCEL_REASON_LABELS[reason];
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}m ${String(whole % 60).padStart(2, "0")}s`;
}

export function summarizeFinishedRun(
  route: Pick<
    SimulationStartResponse,
    "estimated_normal_time_sec" | "estimated_greenwave_time_sec"
  >,
  finalKpis: KpiMetrics,
): { label: string; value: string }[] {
  return [
    { label: "Estimated normal", value: formatDuration(route.estimated_normal_time_sec) },
    { label: "Estimated GreenWave", value: formatDuration(route.estimated_greenwave_time_sec) },
    { label: "Simulated elapsed", value: formatDuration(finalKpis.total_time_elapsed_sec) },
    { label: "Final time saved", value: formatDuration(finalKpis.current_time_saved_sec) },
  ];
}
