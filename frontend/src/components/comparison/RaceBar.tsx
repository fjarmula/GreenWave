import { Square } from "lucide-react";
import type { CSSProperties } from "react";
import { raceReadout, type RaceStanding } from "@/lib/comparison/race";
import { MODE_LABELS } from "./ComparisonLivePane";

/** Both vehicles on one track of the shared route, with the measured lead. */
export function RaceBar({
  standing,
  running,
  stopping,
  onStop,
  tickMilliseconds,
}: {
  standing: RaceStanding;
  running: boolean;
  stopping: boolean;
  onStop: () => void;
  /** The dots glide between ticks, so a move lasts exactly one tick. */
  tickMilliseconds: number;
}) {
  return (
    <section className="race-bar surface-glass" aria-label="Race along the route" data-map-occluder>
      <div className="race-bar-head">
        <p className="race-bar-readout" role="status">
          {raceReadout(standing)}
        </p>
        {running && (
          <button
            type="button"
            data-testid="comparison-stop"
            className="race-bar-stop pressable"
            disabled={stopping}
            aria-busy={stopping}
            onClick={onStop}
          >
            <Square aria-hidden className="size-3 fill-current" />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      <div
        className="race-track"
        aria-hidden
        style={{ "--tick": `${tickMilliseconds}ms` } as CSSProperties}
      >
        {(["DISABLED", "ENABLED"] as const).map((mode) => (
          <span
            key={mode}
            className="race-dot"
            data-mode={mode}
            title={MODE_LABELS[mode]}
            style={{ "--progress": standing.positions[mode] } as CSSProperties}
          />
        ))}
      </div>
      <div className="race-ends">
        <span>Station</span>
        <span className="race-legend">
          <span data-mode="ENABLED">Green Wave</span>
          <span data-mode="DISABLED">Standard traffic</span>
        </span>
        <span>Incident</span>
      </div>
    </section>
  );
}
