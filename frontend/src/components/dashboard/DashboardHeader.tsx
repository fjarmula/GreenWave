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
  onModeChange: (mode: DashboardMode) => void;
};

export function DashboardHeader({ mode, onModeChange }: DashboardHeaderProps) {
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

      <nav
        className="order-3 flex w-full rounded-lg border border-border bg-muted/45 p-1 sm:order-none sm:ml-auto sm:w-auto"
        aria-label="Dashboard mode"
      >
        <ModeButton
          active={mode === "setup"}
          onClick={() => onModeChange("setup")}
          icon={Settings2}
        >
          Dispatch setup
        </ModeButton>
        <ModeButton
          active={mode === "live"}
          onClick={() => onModeChange("live")}
          icon={Activity}
          live
        >
          Live operations
        </ModeButton>
      </nav>

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

type ModeButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: typeof Settings2;
  live?: boolean;
  children: React.ReactNode;
};

function ModeButton({ active, onClick, icon: Icon, live = false, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 sm:flex-none ${
        active
          ? live
            ? "bg-cyan-500/12 text-cyan-700 shadow-sm dark:text-cyan-300"
            : "bg-emerald-500/12 text-emerald-700 shadow-sm dark:text-emerald-300"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}
