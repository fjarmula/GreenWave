"use client";

import { Signal } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type { IntersectionTelemetry } from "@/types/telemetry";

export function IntersectionList() {
  const { liveTelemetry } = useSimulationState();
  const intersections = liveTelemetry?.intersections ?? [];
  return (
    <section className="rounded-xl border border-border/80 bg-card/92 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Corridor monitoring</p>
          <h2 className="mt-1 text-sm font-semibold">
            Active corridor signals <span className="font-normal text-muted-foreground">(TTI)</span>
          </h2>
        </div>
        <Signal className="size-5 text-cyan-600 dark:text-cyan-300" aria-hidden />
      </div>

      <div className="mt-3 space-y-3">
        {!intersections.length && (
          <p className="text-xs text-muted-foreground">Waiting for simulation telemetry.</p>
        )}
        {intersections.map((intersection) => (
          <IntersectionCard key={intersection.id} {...intersection} />
        ))}
      </div>
    </section>
  );
}

function IntersectionCard(intersection: IntersectionTelemetry) {
  const { id, name, state, tti_seconds: ttiSeconds, is_active_corridor: active } = intersection;
  const isCascade = isCascadeClearing(intersection);
  const detail = active ? "SIMULATED CORRIDOR ACTIVE" : "NO PRIORITY REQUEST";

  return (
    <article className="rounded-lg border border-border/70 bg-background/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong className="block font-mono text-xs">{id}</strong>
          <span className="mt-1 block text-[10px] text-muted-foreground">
            {name ?? "Unnamed intersection"}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[9px] font-bold ${
            isCascade
              ? "text-violet-600 dark:text-violet-300"
              : active
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          }`}
        >
          <i className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {state}
          {isCascade && " · CASCADE"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono">
        <strong className="text-[11px] text-muted-foreground">
          TTI:{" "}
          <span className="text-foreground">
            {ttiSeconds === null ? "Passed" : `${ttiSeconds}s`}
          </span>
        </strong>
        <span className="text-[9px] text-muted-foreground">{detail}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full shadow-[0_0_8px_currentColor] ${
            isCascade ? "bg-violet-500 text-violet-500" : "bg-emerald-500 text-emerald-500"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, (ttiSeconds ?? 0) * 2.5))}%` }}
        />
      </div>
    </article>
  );
}
