"use client";
import { useTranslation } from "@/components/language-provider";
import { Square } from "lucide-react";
import type { CSSProperties } from "react";
import { raceReadout, type RaceStanding } from "@/lib/comparison/race";
import { MODE_LABELS } from "./ComparisonLivePane";

/** Both vehicles on one track of the shared route, with the measured lead. */
export function RaceBar({
  standing,
  readout,
  running,
  stopping,
  onStop,
  tickMilliseconds,
}: {
  standing: RaceStanding;
  readout?: string;
  running: boolean;
  stopping: boolean;
  onStop: () => void;
  /** The dots glide between ticks, so a move lasts exactly one tick. */
  tickMilliseconds: number;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="race-bar surface-glass"
      aria-label={t("Race along the route")}
      data-map-occluder
    >
      <div className="race-bar-head">
        <p className="race-bar-readout" role="status">
          {t(readout ?? raceReadout(standing))}
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
            {t(stopping ? "Stopping…" : "Stop")}
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
            title={t(MODE_LABELS[mode])}
            style={{ "--progress": standing.positions[mode] } as CSSProperties}
          />
        ))}
      </div>
      <div className="race-ends">
        <span>{t("Station")}</span>
        <span className="race-legend">
          <span data-mode="ENABLED">{t("Green Wave")}</span>
          <span data-mode="DISABLED">{t("Standard traffic")}</span>
        </span>
        <span>{t("Incident")}</span>
      </div>
    </section>
  );
}
