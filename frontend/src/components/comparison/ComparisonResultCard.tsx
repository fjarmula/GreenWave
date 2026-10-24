import { RotateCcw } from "lucide-react";
import { formatMinutesSeconds } from "@/lib/format-duration";
import type { LiveComparisonState } from "@/lib/comparison/live-comparison";
import { comparisonResult, type ComparisonMode } from "@/lib/comparison/race";
import { RUN_STATUS_LABELS, runStatusKey } from "@/lib/simulation-copy";
import type { SimulationState } from "@/lib/simulation-state";
import { MODE_LABELS, MODE_TONES } from "./ComparisonLivePane";

const outcome = (run: SimulationState) =>
  run.completion
    ? formatMinutesSeconds(run.completion.kpi_metrics.total_time_elapsed_sec)
    : run.cancelReason === "STOPPED"
      ? "Stopped"
      : RUN_STATUS_LABELS[runStatusKey(run.simulationState, run.cancelReason)];

/** The end of a comparison: actual arrival times and their difference, or why it ended. */
export function ComparisonResultCard({
  state,
  onReset,
}: {
  state: LiveComparisonState;
  onReset: () => void;
}) {
  const route = state.runs.ENABLED.routeData;
  const result = route ? comparisonResult(state.runs, state.priorityIds, route) : null;
  const title =
    state.status === "finished"
      ? result
        ? "Comparison result"
        : "Comparison stopped"
      : state.status === "cancelled"
        ? "Comparison cancelled"
        : "Comparison ended";
  const tone = !result ? "" : result.delta > 0 ? "tone-go" : result.delta < 0 ? "tone-caution" : "";
  return (
    <section
      className="comparison-result surface-glass"
      role={state.status === "error" ? "alert" : "status"}
      aria-label={title}
    >
      <h2 className="comparison-result-title">{title}</h2>
      {state.reason && <p className="mt-1 text-sm text-muted-foreground">{state.reason}</p>}
      {result && (
        <p className={`comparison-delta mt-4 ${tone}`}>
          <span className="hud-stat-label">Actual travel-time difference</span>
          <span className="hud-value block text-4xl font-semibold">
            {formatMinutesSeconds(Math.abs(result.delta))}
          </span>
          <span className="hud-chip mt-2">{result.label}</span>
        </p>
      )}
      <dl className="comparison-result-runs">
        {(["ENABLED", "DISABLED"] as ComparisonMode[]).map((mode) => (
          <div key={mode} className={MODE_TONES[mode]}>
            <dt>
              <span aria-hidden className="comparison-chip-dot" />
              {MODE_LABELS[mode]}
            </dt>
            <dd className="hud-value">{outcome(state.runs[mode])}</dd>
          </div>
        ))}
      </dl>
      {result && (
        <p className="mt-3 text-sm">
          Signals given priority {result.prioritised} of {result.total}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Simulated travel times of two runs of the same scenario on one clock.
      </p>
      <button type="button" className="hud-primary pressable mt-4" onClick={onReset}>
        <RotateCcw className="size-4" aria-hidden />
        New comparison
      </button>
    </section>
  );
}
