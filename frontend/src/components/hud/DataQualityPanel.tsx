"use client";

import { useEffect, useState } from "react";
import { ChevronDown, CircleCheck, Info, ShieldAlert, TriangleAlert } from "lucide-react";

import type { SimulationTransport } from "@/lib/config";
import { fetchDatasetQuality } from "@/lib/transport/dataset-quality";
import { toSimulationErrorInfo } from "@/lib/transport/errors";
import type { DatasetQualityResponse, QualityCheck, QualityStatus } from "@/types/telemetry";

export const DATA_QUALITY_FOOTER =
  "Checks describe the source data used by the simulation. They do not verify physical signal states.";
export const DATA_QUALITY_MOCK_NOTICE = "Available when connected to the simulation backend.";
const MAX_METRICS = 4;

export type DataQualityState =
  | { status: "mock" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: DatasetQualityResponse };

function initialDataQualityState(mode: SimulationTransport): DataQualityState {
  return mode === "mock" ? { status: "mock" } : { status: "idle" };
}

type LoaderOptions = {
  mode: SimulationTransport;
  apiBaseUrl: string;
  fetchQuality?: typeof fetchDatasetQuality;
  onChange: (state: DataQualityState) => void;
};

/**
 * Fetches the summary once, on the first expand (never in mock mode). A failure
 * becomes an error state; nothing is thrown, so the rest of the dashboard is unaffected.
 */
export function createDataQualityLoader({
  mode,
  apiBaseUrl,
  fetchQuality = fetchDatasetQuality,
  onChange,
}: LoaderOptions) {
  let controller: AbortController | null = null;
  let done = false;
  return {
    initialState: initialDataQualityState(mode),
    async expand(): Promise<void> {
      if (mode === "mock" || done || controller) return;
      const current = new AbortController();
      controller = current;
      onChange({ status: "loading" });
      try {
        const data = await fetchQuality(apiBaseUrl, current.signal);
        if (current.signal.aborted) return;
        done = true;
        onChange({ status: "loaded", data });
      } catch (error) {
        if (current.signal.aborted) return;
        done = true;
        onChange({ status: "error", message: toSimulationErrorInfo(error).message });
      } finally {
        if (controller === current) controller = null;
      }
    },
    /** Cancels a request in flight (unmount); a later expand may fetch again. */
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}

type DataQualityPanelProps = {
  mode: SimulationTransport;
  apiBaseUrl: string;
};

/** Collapsed-by-default summary of the source-data checks the ETL ran. */
export function DataQualityPanel({ mode, apiBaseUrl }: DataQualityPanelProps) {
  const [state, setState] = useState(() => initialDataQualityState(mode));
  const [loader] = useState(() =>
    createDataQualityLoader({ mode, apiBaseUrl, onChange: setState }),
  );
  useEffect(() => () => loader.abort(), [loader]);

  return (
    <details
      className="group rounded-xl border border-border bg-card"
      onToggle={(event) => {
        if (event.currentTarget.open) void loader.expand();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="dashboard-eyebrow block">Source data checks</span>
          <span className="hud-title block">Data quality</span>
        </span>
        <ChevronDown
          className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border px-4 py-3">
        <DataQualityView state={state} />
      </div>
    </details>
  );
}

const STATUS_STYLE: Record<QualityStatus, { label: string; icon: typeof Info; className: string }> =
  {
    pass: {
      label: "Pass",
      icon: CircleCheck,
      className: "tone-go",
    },
    info: {
      label: "Info",
      icon: Info,
      className: "tone-beacon",
    },
    warn: {
      label: "Warn",
      icon: TriangleAlert,
      className: "tone-caution",
    },
  };

function metricLabel(name: string): string {
  return name.replaceAll("_", " ");
}

function metricValue(name: string, value: number): string {
  if (name.includes("share")) return `${Math.round(value * 100)}%`;
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** The panel body for each loading state (pure, rendered inside the disclosure). */
export function DataQualityView({ state }: { state: DataQualityState }) {
  switch (state.status) {
    case "mock":
      return <p className="text-xs text-muted-foreground">{DATA_QUALITY_MOCK_NOTICE}</p>;
    case "idle":
    case "loading":
      return (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Loading data quality summary…
        </p>
      );
    case "error":
      return (
        <p role="alert" className="flex items-start gap-2 text-xs font-medium text-emergency">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Data quality summary unavailable: {state.message}
        </p>
      );
    case "loaded":
      return <QualitySummary data={state.data} />;
  }
}

function QualitySummary({ data }: { data: DatasetQualityResponse }) {
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {data.checks.map((check) => (
          <QualityCheckItem key={check.id} check={check} />
        ))}
      </ul>

      <section aria-label="Data sources" className="space-y-2">
        <p className="dashboard-eyebrow">Sources</p>
        <ul className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          {data.sources.map((source) => (
            <li key={source.path}>
              <span className="hud-value block break-all text-foreground">{source.path}</span>
              {source.attribution && <span className="block">{source.attribution}</span>}
              <span className="block">
                {[source.licence, `retrieved ${source.retrieved_on}`].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        {data.msip_export_timestamp && (
          <p className="text-[11px] text-muted-foreground">
            MSIP export timestamp:{" "}
            <span className="hud-value text-foreground">{data.msip_export_timestamp}</span>
          </p>
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-muted-foreground">{DATA_QUALITY_FOOTER}</p>
    </div>
  );
}

function QualityCheckItem({ check }: { check: QualityCheck }) {
  const { label, icon: Icon, className } = STATUS_STYLE[check.status];
  const metrics = Object.entries(check.metrics).slice(0, MAX_METRICS);
  return (
    <li className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-semibold">{check.title}</h3>
        <span className={`hud-chip shrink-0 text-[10px] uppercase ${className}`}>
          <Icon aria-hidden />
          {label}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{check.headline}</p>
      {metrics.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {metrics.map(([name, value]) => (
            <div key={name}>
              <dt className="text-[10px] text-muted-foreground">{metricLabel(name)}</dt>
              <dd className="hud-value text-xs font-semibold">{metricValue(name, value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {check.samples.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground">
            Examples ({check.samples.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-muted-foreground">
            {check.samples.map((sample, index) => (
              <li key={index}>{sample}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
