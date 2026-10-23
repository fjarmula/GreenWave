"use client";

import { ItsFeedbackStatus } from "./ItsFeedbackStatus";
import { Activity } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { getFrontendConfig } from "@/lib/config";
import type { SimulationPhase } from "@/lib/simulation-state";

const PHASE_CHIPS: Partial<Record<SimulationPhase, string>> = {
  STARTING: "STARTING",
  RUNNING: "REC",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
  ERROR: "STOPPED",
};

export function ItsConsole() {
  const { itsLog, simulationState, itsRequests, liveTelemetry } = useSimulationState();
  const logEntries = itsLog.slice(-5);
  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card/92 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2.5 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Activity className="size-3.5 text-cyan-600 dark:text-cyan-300" aria-hidden />
          {getFrontendConfig().transport === "mock" ? "Mock" : "Simulated"} ITS gateway audit log
        </span>
        <span className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
          <i
            className={`size-1.5 rounded-full bg-current ${simulationState === "RUNNING" ? "animate-pulse" : ""}`}
          />
          {PHASE_CHIPS[simulationState] ?? "IDLE"}
        </span>
      </div>
      <div className="space-y-2 bg-slate-950/[0.04] px-3 py-3 dark:bg-slate-950/55">
        {itsRequests.map((request) => (
          <ItsFeedbackStatus
            key={request.message_id}
            request={request}
            state={
              liveTelemetry?.intersections.find((i) => request.intersections_group.includes(i.id))
                ?.state
            }
            observedAt={liveTelemetry?.its_observed_at_simulated_sec}
            ended={simulationState !== "RUNNING"}
          />
        ))}
        {liveTelemetry?.its_observed_at_simulated_sec == null && (
          <p className="text-xs text-muted-foreground">ITS feedback unavailable</p>
        )}
        {!logEntries.length && (
          <p className="text-xs text-muted-foreground">
            {simulationState === "SETUP"
              ? "Initialize a simulation to start the audit log."
              : "No simulated ITS dispatches yet."}
          </p>
        )}
        {logEntries.map((entry, index) => {
          const newest = index === logEntries.length - 1;
          return (
            <p
              key={entry.messageId}
              aria-current={newest || undefined}
              className={`flex gap-2 font-mono text-[9px] leading-relaxed ${
                newest ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 text-muted-foreground opacity-60">
                {messageSequence(entry.messageId)}
              </span>
              <span>{entry.text}</span>
            </p>
          );
        })}
      </div>
    </section>
  );
}

/** The contract's `MSG-ITS-<n>` sequence, zero-padded; stable as older rows scroll out. */
function messageSequence(messageId: string): string {
  return (messageId.match(/(\d+)$/)?.[1] ?? "").padStart(2, "0");
}
