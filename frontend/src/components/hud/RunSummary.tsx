"use client";

import { CircleCheck, CircleSlash, Settings2, TriangleAlert } from "lucide-react";

import { useSimulationState } from "@/components/simulation-provider";
import { getFrontendConfig } from "@/lib/config";
import {
  cancelReasonLabel,
  describeSimulationError,
  summarizeFinishedRun,
} from "@/lib/simulation-copy";
import type { SimulationCompletedEvent } from "@/types/telemetry";

type RunSummaryProps = {
  onBackToSetup: () => void;
};

/** End-of-run panel: completed summary, cancellation reason, or a lost stream. */
export function RunSummary({ onBackToSetup }: RunSummaryProps) {
  const { simulationState, routeData, completion, cancelReason, error } = useSimulationState();

  if (simulationState === "FINISHED" && routeData && completion) {
    return (
      <FinishedRunSummary route={routeData} completion={completion} onBackToSetup={onBackToSetup} />
    );
  }

  if (simulationState === "CANCELLED" && cancelReason) {
    return (
      <SummaryCard
        tone="neutral"
        title={`Simulation cancelled · ${cancelReasonLabel(cancelReason)}`}
        detail={
          cancelReason === "SUPERSEDED"
            ? "Another dispatch started a new simulation (only one runs at a time). This tab will not restart it."
            : "The simulation was stopped."
        }
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
  return (
    <SummaryCard
      tone="success"
      title="Simulated run completed"
      detail="The simulated vehicle arrived and every simulated signal is back to NORMAL. Simulated times, not a real-world measurement."
      onBackToSetup={onBackToSetup}
    >
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-lg border border-emerald-500/25 bg-emerald-500/7 px-3 py-2">
          <dt className="text-[10px] text-muted-foreground">{total.label}</dt>
          <dd className="mt-1 font-mono text-2xl font-bold">{total.value}</dd>
        </div>
        {details.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-[10px] text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-mono text-sm font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </SummaryCard>
  );
}

const TONES = {
  success: {
    icon: CircleCheck,
    className: "border-emerald-500/35 text-emerald-600 dark:text-emerald-400",
  },
  neutral: {
    icon: CircleSlash,
    className: "border-amber-500/35 text-amber-700 dark:text-amber-300",
  },
  error: { icon: TriangleAlert, className: "border-red-500/35 text-red-700 dark:text-red-300" },
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
      className={`rounded-xl border bg-card/92 p-4 shadow-2xl backdrop-blur-xl ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="text-foreground">{children}</div>
      <button
        type="button"
        onClick={onBackToSetup}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70"
      >
        <Settings2 className="size-3.5" aria-hidden />
        Back to dispatch setup
      </button>
    </section>
  );
}
