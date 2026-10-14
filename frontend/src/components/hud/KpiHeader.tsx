"use client";

import { Ambulance, TriangleAlert } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";

export function KpiHeader() {
  const { liveTelemetry, simulationState } = useSimulationState();
  const elapsed = liveTelemetry?.kpi_metrics.total_time_elapsed_sec ?? 0;
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <section className="grid grid-cols-2 items-center gap-3 rounded-xl border border-border/80 bg-card/90 p-3 shadow-2xl backdrop-blur-xl sm:grid-cols-[1fr_auto_1fr] sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Ambulance className="size-5 shrink-0 text-cyan-600 dark:text-cyan-300" aria-hidden />
        <div className="min-w-0">
          <strong className="block truncate font-mono text-xs">
            {liveTelemetry?.ambulance.id ?? "Awaiting telemetry"}
          </strong>
          <span className="block text-[10px] text-muted-foreground">
            {liveTelemetry?.ambulance.speed_kmh.toFixed(1) ?? "—"} km/h
          </span>
        </div>
        <span className="ml-1 hidden items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-700 xl:inline-flex dark:text-amber-300">
          <TriangleAlert className="size-3" aria-hidden />
          {simulationState === "FINISHED"
            ? "SIMULATION FINISHED"
            : (liveTelemetry?.ambulance.status.replaceAll("_", " ") ?? "WAITING")}
        </span>
      </div>

      <div className="col-span-2 row-start-1 text-center sm:col-span-1 sm:col-start-2">
        <span className="dashboard-eyebrow block">Time saved</span>
        <strong className="font-mono text-2xl text-emerald-600 drop-shadow-[0_0_12px_rgba(16,185,129,0.28)] dark:text-emerald-400">
          +{liveTelemetry?.kpi_metrics.current_time_saved_sec ?? 0}s
        </strong>
      </div>

      <div className="col-start-2 row-start-2 text-right sm:col-start-3 sm:row-start-1">
        <span className="dashboard-eyebrow block">Elapsed</span>
        <strong className="font-mono text-lg">{elapsedLabel}</strong>
      </div>
    </section>
  );
}
