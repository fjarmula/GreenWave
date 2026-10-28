"use client";
import { useTranslation } from "@/components/language-provider";

import { CircleCheck, Navigation, Square, TriangleAlert } from "lucide-react";
import { VehicleIcon } from "@/components/map/VehicleIcon";
import { VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import { useSimulationState } from "@/components/simulation-provider";
import type { ConnectionStatus } from "@/lib/simulation-adapter";
import { isTelemetryStale } from "@/lib/simulation-state";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import {
  connectionLabel,
  formatSignedSeconds,
  greenWaveModeLabel,
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

// Only a real saving gets the success colour.
const TIME_SAVED_STYLES: Record<TimeSavedTone, string> = {
  positive: "text-go",
  neutral: "text-muted-foreground",
  negative: "text-caution",
};

type KpiHeaderProps = {
  /** Phones only (the desktop Stop is in the run panel): stops the running simulation. */
  onStop?: () => void;
};

export function KpiHeader({ onStop }: KpiHeaderProps = {}) {
  const { t } = useTranslation();
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
  const elapsed = liveTelemetry?.kpi_metrics.total_time_elapsed_sec ?? 0;
  const failedIts = simulationState === "CANCELLED" && cancelReason?.startsWith("ITS_");
  const saved = liveTelemetry?.kpi_metrics.current_time_saved_sec ?? 0;
  const speed = vehicleSpeedPresentation(simulationState, liveTelemetry);
  const stale = isTelemetryStale({ simulationState, connection });
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <section aria-label={t("Simulation telemetry")} className="kpi-panel hud-panel">
      <div className="kpi-vehicle">
        <span
          title={t(VEHICLE_NAMES[vehicleType])}
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${VEHICLE_ICON_COLORS[vehicleType]}`}
        >
          <VehicleIcon type={vehicleType} className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <span className="sr-only">{t(VEHICLE_NAMES[vehicleType])} </span>
          <strong
            className="hud-value block truncate text-sm font-semibold"
            title={t(liveTelemetry?.ambulance.id)}
          >
            {t(liveTelemetry?.ambulance.id ?? "Awaiting telemetry")}
          </strong>
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
            {t(
              OUTCOME_BADGES[status] ??
                liveTelemetry?.ambulance.status.replaceAll("_", " ") ??
                "WAITING",
            )}
          </span>
          {/* Always mounted so screen readers announce every change, including the first. */}
          <span role="status" className="contents">
            {connection && (
              <span className={`hud-chip ${CONNECTION_STYLES[connection]}`}>
                <i
                  aria-hidden
                  className={`hud-dot ${connection === "open" ? "status-breathe" : ""}`}
                />
                <span className="sr-only">{t("Simulation stream: ")}</span>
                {t(connectionLabel(connection))}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="kpi-speed">
        <span className="hud-stat-label">{t(stale ? "Last received speed" : "Speed")}</span>
        <strong
          className="kpi-value hud-value mt-0.5 text-3xl font-semibold"
          title={t(speed.label)}
        >
          {t(speed.value)}
          <span className="kpi-unit">{t(" km/h")}</span>
        </strong>
        <span className="sr-only">{t(speed.label)}</span>
      </div>

      <div className="kpi-saved">
        <span className="hud-stat-label">
          {t(
            failedIts
              ? "No completed savings"
              : routeData?.green_wave_mode === "DISABLED"
                ? "vs normal traffic"
                : "Time saved",
          )}
        </span>
        <strong
          className={`kpi-value hud-value mt-0.5 text-3xl font-semibold ${TIME_SAVED_STYLES[failedIts ? "neutral" : timeSavedTone(saved)]}`}
        >
          {t(failedIts ? "—" : formatSignedSeconds(saved))}
        </strong>
      </div>

      <div className="kpi-elapsed">
        <span className="hud-stat-label">{t("Elapsed")}</span>
        <strong className="kpi-value hud-value mt-0.5 text-3xl font-semibold">
          {t(elapsedLabel)}
        </strong>
        {routeData && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {t(greenWaveModeLabel(routeData.green_wave_mode))}
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
            aria-label={t("Stop simulation")}
            className="hud-danger pressable mt-1.5 ml-auto min-h-9 w-auto px-3 text-xs lg:hidden"
          >
            <Square className="size-3 fill-current" aria-hidden />
            {t(stopRequested ? "Stopping…" : "Stop")}
          </button>
        )}
      </div>
    </section>
  );
}
