import type { DiagnosticEntry } from "@/lib/diagnostics/store";
export function EndpointActivity({ entries }: { entries: ReadonlyArray<DiagnosticEntry> }) {
  return (
    <section className="mt-8" aria-labelledby="activity-title">
      <h2 id="activity-title" className="text-xl font-semibold">
        Recent activity
      </h2>
      <ol
        className="mt-4 max-h-80 space-y-2 overflow-auto rounded-xl border border-border p-4 text-sm"
        aria-label="Observed activity"
      >
        {entries.slice(-30).map((e, i) => (
          <li key={i}>
            {e.transport === "mock" ? "Synthetic" : "Backend"} · {e.operation} ·{" "}
            <strong>{e.outcome}</strong>
            {e.tick === undefined ? "" : ` · tick ${e.tick}`}
            {(e.count ?? 0) > 1 ? ` · ${e.count} sampled ticks` : ""}
          </li>
        ))}
        {!entries.length && <li>Not observed</li>}
      </ol>
    </section>
  );
}
