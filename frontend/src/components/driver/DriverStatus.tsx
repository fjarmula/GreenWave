import type { SimulationState } from "@/lib/simulation-state";
import { isTelemetryStale } from "@/lib/simulation-state";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import {
  connectionLabel,
  runStatusKey,
  RUN_STATUS_LABELS,
  vehicleSpeedPresentation,
} from "@/lib/simulation-copy";
export function DriverStatus({ state, onStop }: { state: SimulationState; onStop: () => void }) {
  if (state.startRequest?.green_wave_mode !== "ENABLED")
    return <p className="hud-alert tone-caution">Enabled simulation required</p>;
  const stale = isTelemetryStale(state);
  const speed = vehicleSpeedPresentation(state.simulationState, state.liveTelemetry);
  return (
    <section aria-label="Driver simulation status" className="hud-panel workspace-float p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Simulated · {VEHICLE_NAMES[state.startRequest.vehicle_type]}
        </p>
        <span
          className={`hud-chip ${state.simulationState === "RUNNING" ? "tone-go" : "tone-caution"}`}
        >
          <i aria-hidden className="hud-dot" />
          {RUN_STATUS_LABELS[runStatusKey(state.simulationState, state.cancelReason)]}
        </span>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <dt className="hud-stat-label">{stale ? "Last received speed" : "Speed"}</dt>
          <dd className="hud-value text-3xl font-semibold">
            {speed.value} <span className="text-sm font-normal text-muted-foreground">km/h</span>
          </dd>
        </div>
        <div>
          <dt className="hud-stat-label">Elapsed simulated</dt>
          <dd className="hud-value text-3xl font-semibold">
            {state.liveTelemetry?.kpi_metrics.total_time_elapsed_sec ?? 0}
            <span className="text-sm font-normal text-muted-foreground"> s</span>
          </dd>
        </div>
      </dl>
      <p
        role="status"
        className={`mt-2 text-xs ${stale ? "text-caution" : "text-muted-foreground"}`}
      >
        {stale
          ? "Last received position · telemetry paused"
          : state.connection
            ? connectionLabel(state.connection)
            : "Simulated run ended"}
      </p>
      {state.stopError && (
        <p role="alert" className="hud-alert tone-emergency mt-2">
          Could not stop: {state.stopError}
        </p>
      )}
      {state.simulationState === "RUNNING" && (
        <button
          data-testid="driver-stop"
          className="hud-danger pressable mt-3"
          disabled={state.stopRequested}
          aria-busy={state.stopRequested}
          onClick={onStop}
        >
          {state.stopRequested ? "Stopping…" : state.stopError ? "Retry Stop" : "Stop simulation"}
        </button>
      )}
    </section>
  );
}
