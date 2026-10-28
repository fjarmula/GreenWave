"use client";
import { useTranslation } from "@/components/language-provider";

import type { LiveComparisonState } from "@/lib/comparison/live-comparison";
import { tickIntervalMilliseconds } from "@/lib/playback-speed";
import { raceStanding, type ComparisonMode } from "@/lib/comparison/race";
import { ComparisonLivePane, MODE_LABELS } from "./ComparisonLivePane";
import { ComparisonResultCard } from "./ComparisonResultCard";
import { RaceBar } from "./RaceBar";

const MODES: ComparisonMode[] = ["ENABLED", "DISABLED"];

/** Two live panes (one with a toggle on phones), the shared race bar, then the result card. */
export function ComparisonStage({
  state,
  pane,
  onPaneChange,
  onStop,
  onReset,
}: {
  state: LiveComparisonState;
  pane: ComparisonMode;
  onPaneChange: (mode: ComparisonMode) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const route = state.runs.ENABLED.routeData;
  const standing = route ? raceStanding(route, state.runs) : null;
  const interrupted = Object.values(state.runs).some(
    (run) => run.cancelReason || run.simulationState === "ERROR",
  );
  const running = state.status === "running";
  const ended =
    state.status === "finished" || state.status === "cancelled" || state.status === "error";
  return (
    <div className="comparison-stage" data-pane={pane}>
      <div className="comparison-maps">
        {MODES.map((mode) => (
          <ComparisonLivePane
            key={mode}
            mode={mode}
            run={state.runs[mode]}
            share={standing?.positions[mode] ?? 0}
          />
        ))}
      </div>
      <div className="comparison-dock">
        <div className="comparison-phone-toggle hud-segmented" role="group" aria-label={t("Map")}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="hud-segment"
              aria-pressed={pane === mode}
              onClick={() => onPaneChange(mode)}
            >
              {t(MODE_LABELS[mode])}
            </button>
          ))}
        </div>
        {standing && (
          <RaceBar
            standing={standing}
            readout={
              interrupted
                ? running
                  ? "Comparison interrupted · waiting for remaining run"
                  : "Comparison ended"
                : undefined
            }
            running={running}
            stopping={state.stopping}
            onStop={onStop}
            tickMilliseconds={tickIntervalMilliseconds(
              state.runs.ENABLED.startRequest?.playback_speed ?? 1,
            )}
          />
        )}
        {state.reason && running && (
          <p role="alert" className="hud-alert tone-emergency">
            {t(state.reason)}
          </p>
        )}
      </div>
      {ended && (
        <div className="comparison-result-layer">
          <ComparisonResultCard state={state} onReset={onReset} />
        </div>
      )}
    </div>
  );
}
