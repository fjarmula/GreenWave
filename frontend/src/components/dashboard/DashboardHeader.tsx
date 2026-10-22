"use client";

import { Activity, Settings2, Siren } from "lucide-react";

import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { useSimulationState } from "@/components/simulation-provider";
import type { SimulationPhase } from "@/lib/simulation-state";

export type DashboardMode = "setup" | "live";

const PHASE_LABELS: Record<SimulationPhase, string> = {
  SETUP: "System ready",
  STARTING: "Computing route",
  RUNNING: "Simulation running",
  FINISHED: "Simulation finished",
  CANCELLED: "Simulation cancelled",
  ERROR: "Simulation error",
};

type DashboardHeaderProps = {
  mode: DashboardMode;
};

/**
 * The view is chosen by the run, not by the user: setup until a corridor is initialized, then
 * live operations until the ended run's "Back to dispatch setup".
 */
export function DashboardHeader({ mode }: DashboardHeaderProps) {
  const { simulationState } = useSimulationState();
  return (
    <header className="z-50 flex flex-wrap items-center gap-3 border-b border-border bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:min-h-[76px] lg:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:min-w-[285px] lg:flex-none">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/25">
          <Siren className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="dashboard-eyebrow truncate">Kraków Municipal Response Network</p>
          <h1 className="truncate text-lg font-bold tracking-[0.09em]">
            ER<span className="text-emerald-500">-</span>GREENWAVE
          </h1>
        </div>
      </div>

      <p
        className={`order-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/45 px-3 text-[11px] font-bold sm:order-none sm:ml-auto sm:w-auto ${
          mode === "live"
            ? "text-cyan-700 dark:text-cyan-300"
            : "text-emerald-700 dark:text-emerald-300"
        }`}
      >
        {mode === "live" ? (
          <Activity className="size-3.5" aria-hidden />
        ) : (
          <Settings2 className="size-3.5" aria-hidden />
        )}
        {mode === "live" ? "Live operations" : "Dispatch setup"}
      </p>

      <div className="order-2 sm:order-none">
        <ThemeToggle />
      </div>

      <div className="ml-2 hidden items-center gap-2 text-[11px] text-muted-foreground xl:flex">
        <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
        <span>{PHASE_LABELS[simulationState]}</span>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="font-mono">SIMULATION ENVIRONMENT</span>
      </div>
    </header>
  );
}
