"use client";

import { CircleCheck, CircleSlash, Radio, Settings2, Square, TriangleAlert } from "lucide-react";

import { useSimulationState } from "@/components/simulation-provider";
import { getFrontendConfig } from "@/lib/config";
import {
  cancelReasonLabel,
  describeSimulationError,
  SAVED_LABEL,
  SERVER_ERROR_COPY,
  summarizeFinishedRun,
  timeSavedTone,
} from "@/lib/simulation-copy";
import { SAVED_VALUE_TONES } from "@/components/hud/time-saved-tone";
import type { SimulationCompletedEvent } from "@/types/telemetry";

type RunSummaryProps = {
  onBackToSetup: () => void;
  /** Stops the live run; setup is offered only once the run has ended. */
  onStop: () => void;
};

/** Live-run panel: Stop while running, then the completed summary, cancellation or lost stream. */
export function RunSummary({ onBackToSetup, onStop }: RunSummaryProps) {
  const { simulationState, routeData, completion, cancelReason, error, stopRequested, stopError } =
    useSimulationState();

  if (simulationState === "RUNNING") {
    return (
      <RunningRunControls stopRequested={stopRequested} stopError={stopError} onStop={onStop} />
    );
  }

  if (simulationState === "FINISHED" && routeData && completion) {
    return (
      <FinishedRunSummary route={routeData} completion={completion} onBackToSetup={onBackToSetup} />
    );
  }

  if (simulationState === "CANCELLED" && cancelReason === "STOPPED") {
    return (
      <SummaryCard
        tone="neutral"
        title="Simulation stopped"
        detail="You stopped the simulated run; the map keeps its last simulated position."
        onBackToSetup={onBackToSetup}
      />
    );
  }

  if (simulationState === "CANCELLED" && cancelReason === "SERVER_ERROR") {
    return (
      <SummaryCard
        tone="error"
        title={SERVER_ERROR_COPY}
        detail="The simulation stopped on the server; the map shows the last received simulated position."
        onBackToSetup={onBackToSetup}
      />
    );
  }

  if (simulationState === "CANCELLED" && cancelReason) {
    return (
      <SummaryCard
        tone="neutral"
        title={`Simulation cancelled · ${cancelReasonLabel(cancelReason)}`}
        detail="Another dispatch started a new simulation (only one runs at a time). This tab will not restart it."
        onBackToSetup={onBackToSetup}
      />
    );
  }

  if (simulationState === "ERROR" && error) {
    return (
      <SummaryCard
        tone="error"
        title={describeSimulationError(error, getFrontendConfig().apiBaseUrl)}
        detail="Telemetry stopped; the map shows the last received simulated position."
        onBackToSetup={onBackToSetup}
      />
    );
  }

  return null;
}

/** The only way out of a live run: Stop, then the ended run offers the way back to setup. */
function RunningRunControls({
  stopRequested,
  stopError,
  onStop,
}: {
  stopRequested: boolean;
  stopError: string | null;
  onStop: () => void;
}) {
  return (
    <section className="hud-panel">
      <div className="flex items-start gap-3">
        <span className="hud-icon tone-beacon">
          <Radio aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="hud-title">Simulation running</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Stop ends the simulated run; you can then return to dispatch setup.
          </p>
        </div>
      </div>
      {stopError && (
        <p role="alert" className="hud-alert tone-emergency mt-3">
          <TriangleAlert aria-hidden />
          Could not stop the simulation: {stopError}
        </p>
      )}
      <button
        type="button"
        data-testid="stop-simulation"
        onClick={onStop}
        disabled={stopRequested}
        aria-busy={stopRequested}
        className="hud-danger pressable mt-4 hidden lg:flex"
      >
        <Square className="size-3.5 fill-current" aria-hidden />
        {stopRequested ? "Stopping…" : "Stop simulation"}
      </button>
    </section>
  );
}

/** Completed run: the total travel time leads, in the mode the run used. */
export function FinishedRunSummary({
  route,
  completion,
  onBackToSetup,
}: {
  route: Parameters<typeof summarizeFinishedRun>[0];
  completion: SimulationCompletedEvent;
  onBackToSetup: () => void;
}) {
  const [total, ...details] = summarizeFinishedRun(route, completion.kpi_metrics);
  const savedTone = SAVED_VALUE_TONES[timeSavedTone(completion.kpi_metrics.current_time_saved_sec)];
  return (
    <SummaryCard
      tone="success"
      title="Simulated run completed"
      detail="The simulated vehicle arrived and every simulated signal is back to NORMAL. Simulated times, not a real-world measurement."
      onBackToSetup={onBackToSetup}
    >
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-lg border border-go/25 bg-go/8 px-3 py-2.5">
          <dt className="hud-stat-label">{total.label}</dt>
          <dd className="hud-value mt-1 text-3xl font-semibold">{total.value}</dd>
        </div>
        {details.map(({ label, value }) => (
          <div key={label}>
            <dt className="hud-stat-label">{label}</dt>
            <dd
              className={[
                "hud-value mt-1 text-sm font-semibold",
                label === SAVED_LABEL && savedTone,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </SummaryCard>
  );
}

const TONES = {
  success: { icon: CircleCheck, className: "tone-go" },
  neutral: { icon: CircleSlash, className: "tone-caution" },
  error: { icon: TriangleAlert, className: "tone-emergency" },
} as const;

function SummaryCard({
  tone,
  title,
  detail,
  onBackToSetup,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  detail: string;
  onBackToSetup: () => void;
  children?: React.ReactNode;
}) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <section
      role={tone === "error" ? "alert" : "status"}
      className={`hud-panel hud-enter ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="hud-icon">
          <Icon aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="hud-title">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div>{children}</div>
      <button type="button" onClick={onBackToSetup} className="hud-secondary pressable mt-4">
        <Settings2 aria-hidden />
        Back to dispatch setup
      </button>
    </section>
  );
}
