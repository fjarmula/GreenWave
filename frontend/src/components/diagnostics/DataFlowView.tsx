import { diagnosticOutcomeLabel, diagnosticTickLabel } from "@/lib/diagnostics/presentation";
import { operations, type DiagnosticEntry, type Operation } from "@/lib/diagnostics/store";
const names: Record<Operation, string> = {
  stations: "Stations",
  geocode: "Geocode",
  ranking: "Ranking",
  start: "Start",
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
        <h2 id="architecture-title" className="text-xl font-semibold">
          How the simulation flows
        </h2>
        <p className="mt-2 text-muted-foreground">
          Architecture explanation — separate from observations below.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            "Stations / Geocode → incident",
            "Ranking → chosen station",
            "Start → route initialization",
            "Request → in-process simulated ITS controller",
            "Controller decision / reported state → SSE",
            "SSE → validated telemetry",
            "Validation / state → Map and HUD",
            "Stop → terminal summary",
          ].map((name, i) => (
            <li key={name} className="rounded-xl border border-border p-4">
              <span className="text-sm text-muted-foreground">{i + 1} / </span>
              {name}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          ITS requests and feedback run inside the simulation process. They are not HTTP controller
          calls. Dataset quality describes the source dataset.
        </p>
      </section>
      <section className="mt-10" aria-labelledby="observations-title">
        <h2 id="observations-title" className="text-xl font-semibold">
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
              <div key={op} className="rounded-xl border border-border p-4">
                <dt className="font-medium">{names[op]}</dt>
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
