"use client";

import { ArrowDown, CircleCheck, Navigation, Square, TriangleAlert } from "lucide-react";
import { VehicleIcon } from "@/components/map/VehicleIcon";
import { VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import { RUN_OUTCOME_TEXT } from "@/components/hud/run-status-tone";
import { useSimulationState } from "@/components/simulation-provider";
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import {
  connectionLabel,
  formatSignedSeconds,
  greenWaveModeLabel,
  RUN_STATUS_LABELS,
  runStatusKey,
  timeSavedTone,
  vehicleSpeedPresentation,
  type RunStatusKey,
  type TimeSavedTone,
} from "@/lib/simulation-copy";

const OUTCOME_BADGES: Partial<Record<RunStatusKey, string>> = {
  FINISHED: "SIMULATION FINISHED",
  CANCELLED: "SIMULATION CANCELLED",
  STOPPED: "SIMULATION STOPPED",
  SERVER_ERROR: "SERVER ERROR",
  ERROR: "TELEMETRY STOPPED",
};

/** The phone run summary sits below the map; the strip's outcome chip jumps to it. */
export const PHONE_RUN_SUMMARY_ID = "run-summary-phone";

function showPhoneRunSummary() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .getElementById(PHONE_RUN_SUMMARY_ID)
    ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

const CONNECTION_STYLES: Record<ConnectionStatus, string> = {
  open: "tone-go",
  connecting: "tone-caution",
  reconnecting: "tone-caution",
  lost: "tone-emergency",
};

/** Ended runs read by outcome; a live run reads as in progress (beacon). */
const OUTCOME_TONES: Partial<Record<RunStatusKey, string>> = {
  FINISHED: "tone-go",
  CANCELLED: "tone-caution",
  STOPPED: "tone-caution",
  SERVER_ERROR: "tone-emergency",
  ERROR: "tone-emergency",
};

// Only a real saving gets the success glow.
const TIME_SAVED_STYLES: Record<TimeSavedTone, string> = {
  positive: "text-go [text-shadow:0_0_18px_color-mix(in_srgb,var(--go)_40%,transparent)]",
  neutral: "text-muted-foreground",
  negative: "text-caution",
};

type KpiHeaderProps = {
  /** Phones only (the desktop Stop is in the run panel): stops the running simulation. */
  onStop?: () => void;
};

export function KpiHeader({ onStop }: KpiHeaderProps = {}) {
  const {
    liveTelemetry,
    simulationState,
    connection,
    routeData,
    stopRequested,
    cancelReason,
    startRequest,
  } = useSimulationState();
  const vehicleType = startRequest?.vehicle_type ?? "AMBULANCE";
  const status = runStatusKey(simulationState, cancelReason);
  const ended =
    simulationState === "FINISHED" ||
    simulationState === "CANCELLED" ||
    simulationState === "ERROR";
  const elapsed = liveTelemetry?.kpi_metrics.total_time_elapsed_sec ?? 0;
  const saved = liveTelemetry?.kpi_metrics.current_time_saved_sec ?? 0;
  const speed = vehicleSpeedPresentation(simulationState, liveTelemetry);
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <section aria-label="Simulation telemetry" className="kpi-panel hud-panel">
      <div className="kpi-vehicle">
        <span
          title={VEHICLE_NAMES[vehicleType]}
          className={`grid size-9 shrink-0 place-items-center rounded-lg shadow-sm ${VEHICLE_ICON_COLORS[vehicleType]}`}
        >
          <VehicleIcon type={vehicleType} className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <span className="sr-only">{VEHICLE_NAMES[vehicleType]} </span>
          <strong className="hud-value block truncate text-sm font-semibold">
            {liveTelemetry?.ambulance.id ?? "Awaiting telemetry"}
          </strong>
          <span className="hud-value block text-xs text-muted-foreground" title={speed.label}>
            {speed.value} km/h<span className="sr-only">, {speed.label}</span>
          </span>
        </div>
        <div className="kpi-statuses">
          <span className={`hud-chip ${OUTCOME_TONES[status] ?? "tone-beacon"}`}>
            {status === "FINISHED" ? (
              <CircleCheck aria-hidden />
            ) : OUTCOME_TONES[status] ? (
              <TriangleAlert aria-hidden />
            ) : (
              <Navigation aria-hidden />
            )}
            {OUTCOME_BADGES[status] ??
              liveTelemetry?.ambulance.status.replaceAll("_", " ") ??
              "WAITING"}
          </span>
          {/* Always mounted so screen readers announce every change, including the first. */}
          <span role="status" className="contents">
            {connection && (
              <span className={`hud-chip ${CONNECTION_STYLES[connection]}`}>
                <i
                  aria-hidden
                  className={`hud-dot ${connection === "open" ? "motion-safe:animate-pulse" : ""}`}
                />
                <span className="sr-only">Simulation stream: </span>
                {connectionLabel(connection)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="kpi-saved">
        <span className="hud-stat-label">Time saved</span>
        <strong
          className={`kpi-value hud-value mt-0.5 text-3xl font-semibold ${TIME_SAVED_STYLES[timeSavedTone(saved)]}`}
        >
          {formatSignedSeconds(saved)}
        </strong>
      </div>

      <div className="kpi-elapsed">
        <span className="hud-stat-label">Elapsed</span>
        <strong className="kpi-value hud-value mt-0.5 text-3xl font-semibold">
          {elapsedLabel}
        </strong>
        {routeData && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {greenWaveModeLabel(routeData.green_wave_mode)}
          </span>
        )}
        {onStop && simulationState === "RUNNING" && (
          // The phone run panel sits below the map; the strip keeps Stop on screen.
          <button
            type="button"
            data-testid="stop-simulation"
            onClick={onStop}
            disabled={stopRequested}
            aria-busy={stopRequested}
            aria-label="Stop simulation"
            className="hud-danger pressable mt-1.5 ml-auto min-h-9 w-auto px-3 text-xs lg:hidden"
          >
            <Square className="size-3 fill-current" aria-hidden />
            {stopRequested ? "Stopping…" : "Stop"}
          </button>
        )}
        {onStop && ended && (
          <button
            type="button"
            data-testid="run-outcome"
            onClick={showPhoneRunSummary}
            className={`hud-secondary pressable mt-1.5 ml-auto min-h-9 w-auto px-3 text-xs lg:hidden ${RUN_OUTCOME_TEXT[status]}`}
          >
            {RUN_STATUS_LABELS[status]}
            <span className="font-medium text-muted-foreground">· Summary</span>
            <ArrowDown className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
