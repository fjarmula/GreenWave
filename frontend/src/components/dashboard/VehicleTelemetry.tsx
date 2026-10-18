"use client";

import { Ambulance, Gauge } from "lucide-react";

import { useSimulationState } from "@/components/simulation-provider";
import { getFrontendConfig } from "@/lib/config";

export function VehicleTelemetry() {
  const { liveTelemetry } = useSimulationState();
  return (
    <div className="absolute top-36 left-6 z-20 hidden w-[292px] space-y-3 lg:block">
      <div className="flex gap-3 rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
          <Ambulance className="size-5" aria-hidden />
        </div>
        <div>
          <p className="dashboard-eyebrow">Priority vehicle</p>
          <h2 className="mt-1 font-mono text-sm font-bold">
            {liveTelemetry?.ambulance.id ?? "Awaiting telemetry"}
          </h2>
          <p className="mt-1 text-[10px] text-muted-foreground">Simulated vehicle telemetry</p>
        </div>
      </div>
      <div className="rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Vehicle telemetry</span>
          <Gauge className="size-4 text-cyan-600 dark:text-cyan-300" aria-hidden />
        </div>
        <div className="mt-4 flex items-end gap-2">
          <strong className="font-mono text-2xl">
            {liveTelemetry?.ambulance.speed_kmh.toFixed(1) ?? "—"}
          </strong>
          <span className="mb-1 text-[10px] text-muted-foreground">km/h</span>
          <b className="mb-1 ml-auto font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
            {getFrontendConfig().transport === "mock" ? "MOCK" : "SIMULATED"}
          </b>
        </div>
        <div className="mt-2 h-1 rounded-full bg-muted">
          <span className="block h-full w-[72%] rounded-full bg-cyan-500" />
        </div>
        <div className="mt-3 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>
            POSITION · {getFrontendConfig().transport === "mock" ? "SYNTHETIC" : "SIMULATED"}
          </span>
          <span>TICK · {liveTelemetry?.tick ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
