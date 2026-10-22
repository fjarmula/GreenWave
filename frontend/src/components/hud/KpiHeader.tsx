"use client";

import { ArrowDown, Square, TriangleAlert } from "lucide-react";
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
  open: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  connecting: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  reconnecting: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  lost: "bg-red-500/10 text-red-700 dark:text-red-300",
};

// Only a real saving gets the success glow.
const TIME_SAVED_STYLES: Record<TimeSavedTone, string> = {
  positive: "text-emerald-600 drop-shadow-[0_0_12px_rgba(16,185,129,0.28)] dark:text-emerald-400",
  neutral: "text-muted-foreground",
  negative: "text-amber-700 dark:text-amber-300",
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
    <section
      aria-label="Simulation telemetry"
      className="kpi-panel rounded-xl border border-border/80 bg-card/90 p-3"
    >
      <div className="kpi-vehicle">
        <span
          title={VEHICLE_NAMES[vehicleType]}
          className={`grid size-7 shrink-0 place-items-center rounded-md ${VEHICLE_ICON_COLORS[vehicleType]}`}
        >
          <VehicleIcon type={vehicleType} className="size-4" />
        </span>
        <div className="min-w-0">
          <span className="sr-only">{VEHICLE_NAMES[vehicleType]} </span>
          <strong className="block truncate font-mono text-xs">
            {liveTelemetry?.ambulance.id ?? "Awaiting telemetry"}
          </strong>
          <span className="block text-xs text-muted-foreground" title={speed.label}>
            {speed.value} km/h<span className="sr-only">, {speed.label}</span>
          </span>
        </div>
        <div className="kpi-statuses">
          <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3" aria-hidden />
            {OUTCOME_BADGES[status] ??
              liveTelemetry?.ambulance.status.replaceAll("_", " ") ??
              "WAITING"}
          </span>
          {/* Always mounted so screen readers announce every change, including the first. */}
          <span role="status" className="contents">
            {connection && (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${CONNECTION_STYLES[connection]}`}
              >
                <i
                  aria-hidden
                  className={`size-1.5 rounded-full bg-current ${connection === "open" ? "animate-pulse" : ""}`}
                />
                <span className="sr-only">Simulation stream: </span>
                {connectionLabel(connection)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="kpi-saved">
        <span className="dashboard-eyebrow block">Time saved</span>
        <strong
          className={`kpi-value font-mono text-2xl ${TIME_SAVED_STYLES[timeSavedTone(saved)]}`}
        >
          {formatSignedSeconds(saved)}
        </strong>
      </div>

      <div className="kpi-elapsed">
        <span className="dashboard-eyebrow block">Elapsed</span>
        <strong className="kpi-value font-mono text-lg">{elapsedLabel}</strong>
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
            className="mt-1.5 ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 text-[10px] font-bold text-red-700 transition hover:bg-red-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 disabled:cursor-wait disabled:opacity-70 lg:hidden dark:text-red-300"
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
            className={`mt-1.5 ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 text-[10px] font-bold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 lg:hidden ${RUN_OUTCOME_TEXT[status]}`}
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
