import type { SimulationState } from "@/lib/simulation-state";
import { isTelemetryStale } from "@/lib/simulation-state";
import { VEHICLE_NAMES } from "@/lib/station-copy";
import {
  connectionLabel,
  cancelReasonLabel,
  runStatusKey,
  RUN_STATUS_LABELS,
  vehicleSpeedPresentation,
} from "@/lib/simulation-copy";
export function DriverStatus({ state, onStop }: { state: SimulationState; onStop: () => void }) {
  if (state.startRequest?.green_wave_mode !== "ENABLED") return <p>Enabled simulation required</p>;
  const stale = isTelemetryStale(state);
  const speed = vehicleSpeedPresentation(state.simulationState, state.liveTelemetry);
  return (
    <section
      aria-label="Driver simulation status"
      className="rounded-xl border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Simulated · {VEHICLE_NAMES[state.startRequest.vehicle_type]}
        </p>
        <span className="text-sm">
          {RUN_STATUS_LABELS[runStatusKey(state.simulationState, state.cancelReason)]}
        </span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 tabular-nums">
        <div>
          <dt className="text-xs text-muted-foreground">
            {stale ? "Last received speed" : "Speed"}
          </dt>
          <dd className="text-2xl font-semibold">
            {speed.value} <span className="text-sm font-normal">km/h</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Elapsed simulated</dt>
          <dd className="text-2xl font-semibold">
            {state.liveTelemetry?.kpi_metrics.total_time_elapsed_sec ?? 0}
            <span className="text-sm font-normal"> s</span>
          </dd>
        </div>
      </dl>
      <p role="status" className="mt-2 text-sm">
        {stale
          ? "Last received position · telemetry paused"
          : state.connection
            ? connectionLabel(state.connection)
            : "Simulated run ended"}
      </p>
      {state.simulationState !== "RUNNING" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last simulated controller report ·{" "}
          {state.cancelReason ? cancelReasonLabel(state.cancelReason) : "Run ended"}
        </p>
      )}
      {state.stopError && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          Could not stop: {state.stopError}
        </p>
      )}
      {state.simulationState === "RUNNING" && (
        <button
          data-testid="driver-stop"
          className="workspace-button mt-3 w-full border-red-500/40 text-red-700 dark:text-red-300"
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
