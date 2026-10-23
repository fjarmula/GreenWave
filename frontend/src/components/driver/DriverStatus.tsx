import { Settings2, Square } from "lucide-react";
import { etaSeconds, savedPill } from "@/lib/driver-presentation";
import type { SimulationState } from "@/lib/simulation-state";
import { isTelemetryStale } from "@/lib/simulation-state";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import {
  cancelReasonLabel,
  connectionLabel,
  formatDuration,
  runStatusKey,
  RUN_STATUS_LABELS,
  timeSavedTone,
  vehicleSpeedPresentation,
} from "@/lib/simulation-copy";

const PILL_TONES = { positive: "tone-go", neutral: "tone-beacon", negative: "tone-caution" };

/** The compact driver card: speed, ETA and the saving while running; the result once ended. */
export function DriverStatus({
  state,
  onStop,
  onBackToSetup = () => {},
}: {
  state: SimulationState;
  onStop: () => void;
  onBackToSetup?: () => void;
}) {
  if (state.startRequest?.green_wave_mode !== "ENABLED")
    return <p className="hud-alert tone-caution">Enabled simulation required</p>;
  const running = state.simulationState === "RUNNING";
  const stale = isTelemetryStale(state);
  const speed = vehicleSpeedPresentation(state.simulationState, state.liveTelemetry);
  const kpis = state.completion?.kpi_metrics ?? state.liveTelemetry?.kpi_metrics ?? null;
  const saved = kpis?.current_time_saved_sec ?? 0;
  const status = RUN_STATUS_LABELS[runStatusKey(state.simulationState, state.cancelReason)];

  if (!running) {
    const detail =
      state.simulationState === "FINISHED" && state.completion
        ? `Arrived in ${formatDuration(state.completion.kpi_metrics.total_time_elapsed_sec)}`
        : state.cancelReason === "STOPPED" || state.cancelReason === "SERVER_ERROR"
          ? status
          : state.cancelReason
            ? `Cancelled · ${cancelReasonLabel(state.cancelReason)}`
            : "Telemetry stopped";
    return (
      <section aria-label="Driver simulation result" className="driver-card" role="status">
        <p className="driver-card-eyebrow">
          Simulated · {VEHICLE_NAMES[state.startRequest.vehicle_type]}
        </p>
        <p className="driver-card-result">{detail}</p>
        {state.simulationState === "FINISHED" && (
          <p className={`hud-chip mt-2 ${PILL_TONES[timeSavedTone(saved)]}`}>{savedPill(saved)}</p>
        )}
        <button type="button" className="hud-secondary pressable mt-3" onClick={onBackToSetup}>
          <Settings2 aria-hidden />
          Back to setup
        </button>
      </section>
    );
  }

  const eta = state.routeData ? etaSeconds(state.routeData, state.liveTelemetry) : null;
  const stopLabel = state.stopRequested
    ? "Stopping…"
    : state.stopError
      ? "Retry Stop"
      : "Stop simulation";
  return (
    <section aria-label="Driver simulation status" className="driver-card">
      <div className="driver-card-row">
        <dl className="driver-card-stats">
          <div>
            <dt className="hud-stat-label">{stale ? "Last received speed" : "Speed"}</dt>
            <dd className="hud-value driver-card-speed">
              {speed.value}
              <span className="driver-card-unit"> km/h</span>
            </dd>
          </div>
          {eta !== null && (
            <div>
              <dt className="hud-stat-label">ETA</dt>
              <dd className="hud-value driver-card-eta">{formatDuration(eta)}</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          data-testid="driver-stop"
          className="driver-stop pressable"
          disabled={state.stopRequested}
          aria-busy={state.stopRequested}
          aria-label={stopLabel}
          title={stopLabel}
          onClick={onStop}
        >
          <Square aria-hidden className="size-4 fill-current" />
        </button>
      </div>
      <p className={`hud-chip mt-2 ${PILL_TONES[timeSavedTone(saved)]}`}>{savedPill(saved)}</p>
      <p
        role="status"
        className={`mt-2 text-xs ${stale ? "text-caution" : "text-muted-foreground"}`}
      >
        Simulated · {VEHICLE_NAMES[state.startRequest.vehicle_type]} ·{" "}
        {stale
          ? "Last received position · telemetry paused"
          : state.connection
            ? connectionLabel(state.connection)
            : status}
      </p>
      {state.stopError && (
        <p role="alert" className="hud-alert tone-emergency mt-2">
          Could not stop: {state.stopError}
        </p>
      )}
    </section>
  );
}
