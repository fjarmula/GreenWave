"use client";

import { Activity } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";

export function ItsConsole() {
  const { itsLog, simulationState } = useSimulationState();
  const logEntries = itsLog.slice(-5);
  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card/92 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2.5 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Activity className="size-3.5 text-cyan-600 dark:text-cyan-300" aria-hidden />
          Mock ITS gateway audit log
        </span>
        <span className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
          <i className="size-1.5 animate-pulse rounded-full bg-current" />
          {simulationState === "RUNNING"
            ? "REC"
            : simulationState === "FINISHED"
              ? "FINISHED"
              : "IDLE"}
        </span>
      </div>
      <div className="space-y-2 bg-slate-950/[0.04] px-3 py-3 dark:bg-slate-950/55">
        {!logEntries.length && (
          <p className="text-xs text-muted-foreground">
            Initialize a simulation to start the mock audit log.
          </p>
        )}
        {logEntries.map((entry, index) => (
          <p
            key={entry.messageId}
            className={`flex gap-2 font-mono text-[9px] leading-relaxed ${
              index === 2 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
            }`}
          >
            <span className="shrink-0 text-muted-foreground opacity-60">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{entry.text}</span>
          </p>
        ))}
      </div>
    </section>
  );
}
