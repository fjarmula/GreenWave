"use client";
import { useTranslation } from "@/components/language-provider";

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
  const { t } = useTranslation();
  const { itsLog, simulationState, itsRequests, liveTelemetry } = useSimulationState();
  const logEntries = itsLog.slice(-5);
  return (
    <section className="hud-panel overflow-hidden p-0">
      <div className="flex items-center justify-between gap-4 border-b border-border px-3.5 py-2.5 text-2xs font-medium text-muted-foreground">
        <span className="flex items-center gap-2">
          <Activity className="size-3.5 text-beacon" aria-hidden />
          {t(getFrontendConfig().transport === "mock" ? "Mock" : "Simulated")}
          {t(" ITS gateway audit log")}
        </span>
        <span
          className={`hud-chip hud-value text-2xs ${simulationState === "RUNNING" ? "tone-emergency" : ""}`}
        >
          <i className={`hud-dot ${simulationState === "RUNNING" ? "status-breathe" : ""}`} />
          {t(PHASE_CHIPS[simulationState] ?? "IDLE")}
        </span>
      </div>
      <div className="space-y-1.5 bg-muted/50 px-3.5 py-3 dark:bg-black/25">
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
          <p className="text-xs text-muted-foreground">{t("ITS feedback unavailable")}</p>
        )}
        {!logEntries.length && (
          <p className="text-xs text-muted-foreground">
            {t(
              simulationState === "SETUP"
                ? "Initialize a simulation to start the audit log."
                : "No simulated ITS dispatches yet.",
            )}
          </p>
        )}
        {logEntries.map((entry, index) => {
          const newest = index === logEntries.length - 1;
          return (
            <p
              key={entry.messageId}
              aria-current={newest || undefined}
              className={`hud-value flex gap-2 text-2xs leading-relaxed ${
                newest ? "text-go" : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 text-muted-foreground opacity-60">
                {t(messageSequence(entry.messageId))}
              </span>
              <span>{t(entry.text)}</span>
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
