"use client";
import { useTranslation } from "@/components/language-provider";
import { History } from "lucide-react";

import type { PreviousRun } from "@/lib/previous-run";
import { SAVED_VALUE_TONES } from "@/components/hud/time-saved-tone";
import {
  formatDuration,
  greenWaveModeLabel,
  SAVED_LABEL,
  timeSavedTone,
} from "@/lib/simulation-copy";

type PreviousRunCardProps = {
  run: PreviousRun;
};

/** The last finished run, so the next one (e.g. the other ER Green Wave mode) can be compared. */
export function PreviousRunCard({ run }: PreviousRunCardProps) {
  const { t } = useTranslation();
  const enabled = run.greenWaveMode === "ENABLED";
  return (
    <section
      aria-labelledby="previous-run-heading"
      className="mt-6 rounded-xl border border-border bg-muted/40 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="previous-run-heading" className="text-sm font-semibold">
          {t("Previous simulated run")}
        </h3>
        <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className={`hud-chip mt-2 ${enabled ? "tone-go" : "tone-caution"}`}>
        {t(greenWaveModeLabel(run.greenWaveMode))}
      </p>
      <p className="mt-2 text-2xs break-words text-muted-foreground">
        {t(run.stationName)}
        {t(" → ")}
        {t(run.incidentLabel)}
        {t(" · ")}
        {t(run.trafficDensity.toFixed(1))}
        {t("x traffic")}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {/* Values share a baseline even when one label wraps onto two lines. */}
        <div className="flex flex-col justify-between">
          <dt className="text-2xs text-muted-foreground">{t("Total travel time")}</dt>
          <dd className="hud-value mt-1 text-lg font-semibold">
            {t(formatDuration(run.totalSeconds))}
          </dd>
        </div>
        <div className="flex flex-col justify-between">
          <dt className="text-2xs text-muted-foreground">{t(SAVED_LABEL)}</dt>
          <dd
            className={`hud-value mt-1 text-lg font-semibold ${SAVED_VALUE_TONES[timeSavedTone(run.savedSeconds)]}`}
          >
            {t(formatDuration(run.savedSeconds))}
          </dd>
        </div>
      </dl>
    </section>
  );
}
