import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";
import { interpolateAlongRoute } from "@/lib/route-position";
import type { RecordedRun } from "./recording";
import type { ComparisonPair } from "./comparison-controller";
export function advanceReplay(
  cursor: number,
  delta: number,
  playing: boolean,
  visible: boolean,
  duration: number,
  speed = 1,
) {
  return playing && visible ? Math.min(duration, Math.max(0, cursor + delta * speed)) : cursor;
}
export function completionDelta(pair: ComparisonPair) {
  return (
    pair.disabled.completion.kpi_metrics.total_time_elapsed_sec -
    pair.enabled.completion.kpi_metrics.total_time_elapsed_sec
  );
}
export function selectReplayFrame(run: RecordedRun, elapsed: number): SimulationState {
  const t = Math.min(run.completion.tick, Math.max(0, elapsed));
  const whole = Math.floor(t);
  const current = run.ticks[Math.max(0, whole - 1)],
    next = run.ticks[Math.min(run.ticks.length - 1, whole)];
  const from = whole === 0 ? run.request.origin : current.ambulance.position;
  const point = interpolateAlongRoute(
    run.route.route_geometry,
    [from.lng, from.lat],
    [next.ambulance.position.lng, next.ambulance.position.lat],
    t - whole,
  );
  const ended = t >= run.completion.tick;
  return {
    ...initialSimulationState,
    startRequest: run.request,
    routeData: run.route,
    simulationState: ended ? "FINISHED" : "RUNNING",
    connection: null,
    completion: ended ? run.completion : null,
    lastTick: whole,
    itsRequests: whole === 0 ? [] : (current.its_requests ?? []),
    liveTelemetry: {
      ...current,
      tick: whole,
      ambulance: {
        ...current.ambulance,
        position: { lng: point[0], lat: point[1] },
        ...(whole === 0 ? { status: "EN_ROUTE" as const, speed_kmh: 0 } : {}),
      },
      intersections: whole === 0 ? [] : current.intersections,
      signal_phases: whole === 0 ? [] : current.signal_phases,
      kpi_metrics: { ...current.kpi_metrics, total_time_elapsed_sec: t },
    },
  };
}
export function comparisonResultLabel(delta: number) {
  return delta === 0
    ? "same travel time"
    : delta > 0
      ? "Green Wave faster"
      : "standard traffic faster";
}
