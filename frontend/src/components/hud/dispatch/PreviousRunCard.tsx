import { History } from "lucide-react";

import type { PreviousRun } from "@/lib/previous-run";
import { formatDuration, greenWaveModeLabel } from "@/lib/simulation-copy";

type PreviousRunCardProps = {
  run: PreviousRun;
};

/** The last finished run, so the next one (e.g. the other ER Green Wave mode) can be compared. */
export function PreviousRunCard({ run }: PreviousRunCardProps) {
  const enabled = run.greenWaveMode === "ENABLED";
  return (
    <section
      aria-labelledby="previous-run-heading"
      className="mt-6 rounded-xl border border-border bg-muted/35 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="previous-run-heading" className="text-sm font-semibold">
          Previous simulated run
        </h3>
        <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p
        className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${
          enabled
            ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
            : "border border-border bg-background text-foreground/80"
        }`}
      >
        {greenWaveModeLabel(run.greenWaveMode)}
      </p>
      <p className="mt-2 text-[11px] break-words text-muted-foreground">
        {run.stationName} → {run.incidentLabel} · {run.trafficDensity.toFixed(1)}x traffic
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {/* Values share a baseline even when one label wraps onto two lines. */}
        <div className="flex flex-col justify-between">
          <dt className="text-[10px] text-muted-foreground">Total travel time</dt>
          <dd className="mt-1 font-mono text-lg font-bold">{formatDuration(run.totalSeconds)}</dd>
        </div>
        <div className="flex flex-col justify-between">
          <dt className="text-[10px] text-muted-foreground">Saved vs normal-traffic estimate</dt>
          <dd className="mt-1 font-mono text-lg font-bold">{formatDuration(run.savedSeconds)}</dd>
        </div>
      </dl>
    </section>
  );
}
