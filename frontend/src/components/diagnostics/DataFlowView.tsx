import { diagnosticOutcomeLabel, diagnosticTickLabel } from "@/lib/diagnostics/presentation";
import { ArrowRight } from "lucide-react";
import { operations, type DiagnosticEntry, type Operation } from "@/lib/diagnostics/store";
const names: Record<Operation, string> = {
  stations: "Stations",
  geocode: "Geocode",
  ranking: "Ranking",
  resources: "Team roster",
  start: "Start",
  "compare-start": "Comparison start",
  sse: "SSE",
  stop: "Stop",
  quality: "Dataset quality",
  its: "ITS · outgoing simulated request",
  "its-feedback": "ITS · incoming controller feedback",
};
export function DataFlowView({ entries }: { entries: ReadonlyArray<DiagnosticEntry> }) {
  return (
    <>
      <section aria-labelledby="architecture-title">
        <h2 id="architecture-title" className="text-xl font-semibold tracking-tight">
          How the simulation flows
        </h2>
        <p className="mt-2 text-muted-foreground">
          Architecture explanation — separate from observations below.
        </p>
        <ol className="flow-steps mt-6">
          {[
            "Stations / Geocode → incident",
            "Ranking → chosen station",
            "Start → route initialization",
            "Request → in-process simulated ITS controller",
            "Controller decision / reported state → SSE",
            "SSE → validated telemetry",
            "Validation / state → Map and HUD",
            "Stop → terminal summary",
          ].map((name, i) => {
            const [source, result] = name.split(" → ");
            return (
              <li key={name} className="flow-step">
                <span className="flow-step-index hud-value" aria-hidden>
                  {i + 1}
                </span>
                <span className="sr-only">Step {i + 1}: </span>
                <span className="font-medium">{source}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ArrowRight className="size-3.5 shrink-0 text-beacon" aria-hidden />
                  <span className="sr-only">→ </span>
                  {result}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          ITS requests and feedback run inside the simulation process. They are not HTTP controller
          calls. Dataset quality describes the source dataset.
        </p>
      </section>
      <section className="mt-10" aria-labelledby="observations-title">
        <h2 id="observations-title" className="text-xl font-semibold tracking-tight">
          Observed in this browser session
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Browser durations only. Repeated ticks are coalesced; counts show sampled activity. Bodies
          and endpoint queries are retained temporarily for JSON inspection in this browser only.
          Clear history removes them. Each tick is one simulated second, independent of playback
          speed. Several events can share a tick; tick numbers do not count messages.
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          {operations.map((op) => {
            const entry = entries.findLast((e) => e.operation === op);
            return (
              <div key={op} className="hud-panel">
                <dt className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-full ${
                      !entry
                        ? "bg-muted-foreground/40"
                        : entry.outcome === "success"
                          ? "bg-go"
                          : "bg-caution"
                    }`}
                  />
                  {names[op]}
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  {entry
                    ? `${entry.transport === "mock" ? "Synthetic (mock)" : "Backend simulation"} · ${diagnosticOutcomeLabel(entry)}${diagnosticTickLabel(entry.tick)}${entry.durationMs === undefined ? "" : ` · browser ${entry.durationMs.toFixed(1)} ms`}${(entry.count ?? 0) > 1 ? ` · ${entry.count} sampled ticks` : ""}`
                    : "Not observed"}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
    </>
  );
}
