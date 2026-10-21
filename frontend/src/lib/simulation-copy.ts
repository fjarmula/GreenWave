/** User-facing English copy for simulation states and errors. */
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  CancelReason,
  ErrorCode,
  GreenWaveMode,
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
  NO_STATION_REACHABLE: "No station of this type can reach this location",
};

export function describeSimulationError(error: SimulationErrorInfo, apiBaseUrl: string): string {
  if (error.kind === "network") {
    return error.reason === "timeout"
      ? `Simulation backend at ${apiBaseUrl} did not answer in time`
      : `Simulation backend unreachable at ${apiBaseUrl}`;
  }
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

/** `mm`m `ss`s; negative values (D15 allows a small negative saving) get a minus sign. */
export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const whole = Math.abs(rounded);
  const sign = rounded < 0 ? "−" : "";
  return `${sign}${String(Math.floor(whole / 60)).padStart(2, "0")}m ${String(whole % 60).padStart(2, "0")}s`;
}

export function formatSignedSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  return rounded < 0 ? `−${Math.abs(rounded)}s` : `+${rounded}s`;
}

export function greenWaveModeLabel(mode: GreenWaveMode): string {
  return mode === "ENABLED" ? "ER Green Wave enabled" : "ER Green Wave disabled";
}

/**
 * The simulated arrival time first, then the mode it was run in. Estimates are simulated
 * baselines; the GreenWave estimate is shown only for a run that used ER Green Wave.
 */
export function summarizeFinishedRun(
  route: Pick<
    SimulationStartResponse,
    "estimated_normal_time_sec" | "estimated_greenwave_time_sec" | "green_wave_mode"
  >,
  finalKpis: KpiMetrics,
): { label: string; value: string }[] {
  const enabled = route.green_wave_mode === "ENABLED";
  return [
    { label: "Total travel time", value: formatDuration(finalKpis.total_time_elapsed_sec) },
    { label: "ER Green Wave", value: enabled ? "Enabled" : "Disabled" },
    { label: "Normal-traffic estimate", value: formatDuration(route.estimated_normal_time_sec) },
    ...(enabled
      ? [
          {
            label: "GreenWave estimate",
            value: formatDuration(route.estimated_greenwave_time_sec),
          },
        ]
      : []),
    {
      label: "Saved vs normal-traffic estimate",
      value: formatDuration(finalKpis.current_time_saved_sec),
    },
  ];
}
