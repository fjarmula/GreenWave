/** User-facing English copy for simulation states and errors. */
import { formatSignalDistance } from "@/lib/driver-presentation";
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import type { SimulationPhase } from "@/lib/simulation-state";
import type { SimulationErrorInfo } from "@/lib/transport/errors";
import type {
  CancelReason,
  ErrorCode,
  GreenWaveMode,
  KpiMetrics,
  SimulationStartResponse,
  SimulationTickEvent,
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

/** D2: a server-side failure (loop crash or 5xx start); the user retries from setup. */
export const SERVER_ERROR_COPY =
  "Simulation server error. Retry the green corridor initialization.";

export function describeSimulationError(error: SimulationErrorInfo, apiBaseUrl: string): string {
  if (error.kind === "network") {
    return error.reason === "timeout"
      ? `Simulation backend at ${apiBaseUrl} did not answer in time`
      : `Simulation backend unreachable at ${apiBaseUrl}`;
  }
  if (error.code) return ERROR_MESSAGES[error.code];
  if (error.status !== undefined && error.status >= 500) return SERVER_ERROR_COPY;
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
  SERVER_ERROR: "Server error",
  ITS_REJECTED: "Simulated ITS controller rejected priority",
  ITS_TIMEOUT: "Simulated ITS acknowledgement timed out",
  ITS_HOLD_EXPIRED: "Simulated ITS priority hold expired",
};

/** A phase, refined by why a cancelled run ended: a user stop and a server failure read differently. */
export type RunStatusKey = SimulationPhase | "STOPPED" | "SERVER_ERROR";

export function runStatusKey(
  phase: SimulationPhase,
  cancelReason: CancelReason | null,
): RunStatusKey {
  if (phase === "CANCELLED" && cancelReason === "STOPPED") return "STOPPED";
  if (phase === "CANCELLED" && cancelReason === "SERVER_ERROR") return "SERVER_ERROR";
  return phase;
}

export const RUN_STATUS_LABELS: Record<RunStatusKey, string> = {
  SETUP: "System ready",
  STARTING: "Computing route",
  RUNNING: "Simulation running",
  FINISHED: "Simulation finished",
  CANCELLED: "Simulation cancelled",
  STOPPED: "Simulation stopped",
  SERVER_ERROR: "Simulation server error",
  ERROR: "Simulation error",
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

export type TimeSavedTone = "positive" | "neutral" | "negative";

/** The sign of a saving as displayed (whole seconds), so "+0s" never reads as a gain. */
export function timeSavedTone(seconds: number): TimeSavedTone {
  const rounded = Math.round(seconds);
  return rounded > 0 ? "positive" : rounded < 0 ? "negative" : "neutral";
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
export const SAVED_LABEL = "Saved vs standard run";

export function summarizeFinishedRun(
  route: Pick<
    SimulationStartResponse,
    "estimated_standard_time_sec" | "estimated_greenwave_time_sec" | "green_wave_mode"
  > &
    Partial<Pick<SimulationStartResponse, "destination_on_foot">>,
  finalKpis: KpiMetrics,
): { label: string; value: string }[] {
  const enabled = route.green_wave_mode === "ENABLED";
  return [
    {
      label: route.destination_on_foot ? "Drive to access point" : "Total travel time",
      value: formatDuration(finalKpis.total_time_elapsed_sec),
    },
    ...(route.destination_on_foot
      ? [
          {
            label: "On foot to incident (estimate)",
            value: `${formatSignalDistance(route.destination_on_foot.distance_m)} · ${formatDuration(route.destination_on_foot.seconds)}`,
          },
        ]
      : []),
    { label: "ER Green Wave", value: enabled ? "Enabled" : "Disabled" },
    { label: "Standard time", value: formatDuration(route.estimated_standard_time_sec) },
    ...(enabled
      ? [
          {
            label: "GreenWave estimate",
            value: formatDuration(route.estimated_greenwave_time_sec),
          },
        ]
      : []),
    ...(enabled
      ? [{ label: SAVED_LABEL, value: formatDuration(finalKpis.current_time_saved_sec) }]
      : []),
  ];
}

/**
 * Current vehicle speed for display. A tick's `speed_kmh` is the distance driven during
 * that simulated second, so the arrival tick can be positive; after the run it is history,
 * not current state. The retained sample itself is left untouched.
 */
export function vehicleSpeedPresentation(
  phase: SimulationPhase,
  telemetry: SimulationTickEvent | null,
): { value: string; label: string } {
  if (phase === "FINISHED") return { value: "0.0", label: "At destination" };
  if (phase === "CANCELLED" || phase === "ERROR") return { value: "—", label: "No current speed" };
  if (phase === "RUNNING" && telemetry) {
    return {
      value: telemetry.ambulance.speed_kmh.toFixed(1),
      label: "Speed during last simulated second",
    };
  }
  return { value: "—", label: "Awaiting telemetry" };
}
