import { MapContainer } from "@/components/map/MapContainer";
import { formatSignalDistance } from "@/lib/driver-presentation";
import { cancelReasonLabel, vehicleSpeedPresentation } from "@/lib/simulation-copy";
import { isTelemetryStale, type SimulationState } from "@/lib/simulation-state";
import type { ComparisonMode } from "@/lib/comparison/race";

export const MODE_LABELS: Record<ComparisonMode, string> = {
  ENABLED: "Green Wave",
  DISABLED: "Standard traffic",
};
export const MODE_TONES: Record<ComparisonMode, string> = {
  ENABLED: "tone-go",
  DISABLED: "tone-caution",
};

/** One live run on its own map, labelled, with its speed and the distance still to drive. */
export function ComparisonLivePane({
  mode,
  run,
  share,
}: {
  mode: ComparisonMode;
  run: SimulationState;
  /** Share of the route driven, 0–1 (from the race standing). */
  share: number;
}) {
  const request = run.startRequest;
  const route = run.routeData;
  const speed = vehicleSpeedPresentation(run.simulationState, run.liveTelemetry);
  const stale = isTelemetryStale(run);
  const left = route ? Math.max(0, route.total_distance_m * (1 - share)) : null;
  return (
    <section
      className="comparison-pane"
      data-mode={mode}
      data-tick={run.lastTick}
      aria-label={`${MODE_LABELS[mode]} live simulation`}
    >
      {request && (
        <MapContainer
          live
          snapshot={run}
          origin={{ label: "Station", position: request.origin }}
          destination={{ label: "Incident", position: request.destination }}
          focusRequest={0}
          stations={[]}
          selectedVehicleType={request.vehicle_type}
          chosenStationId={null}
          runnerUpIds={[]}
          onMapClick={() => {}}
        />
      )}
      <div className="comparison-pane-chips">
        <p className={`comparison-chip surface-glass ${MODE_TONES[mode]}`}>
          <span aria-hidden className="comparison-chip-dot" />
          {MODE_LABELS[mode]}
        </p>
        <p className="comparison-chip comparison-stat surface-glass">
          <span className="hud-value">
            {speed.value}
            <span className="text-muted-foreground"> km/h</span>
          </span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="hud-value">
            {run.cancelReason
              ? cancelReasonLabel(run.cancelReason)
              : run.simulationState === "ERROR"
                ? "Telemetry stopped"
                : run.simulationState === "FINISHED"
                  ? "Arrived"
                  : stale
                    ? "Reconnecting…"
                    : left === null
                      ? "—"
                      : `${formatSignalDistance(left)} left`}
          </span>
        </p>
      </div>
    </section>
  );
}
