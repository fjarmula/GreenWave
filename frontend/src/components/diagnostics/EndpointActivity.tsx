"use client";
import { useState } from "react";
import { JsonInspectButton, JsonViewer, type JsonInspection } from "./JsonDetails";
import type { DiagnosticEntry } from "@/lib/diagnostics/store";
export function EndpointActivity({ entries }: { entries: ReadonlyArray<DiagnosticEntry> }) {
  const [selection, setSelection] = useState<JsonInspection | null>(null);
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
            {(e.count ?? 0) > 1 ? ` · ${e.count} sampled ticks · latest payload` : ""}
            {e.capture && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <span className="json-activity-endpoint text-xs text-muted-foreground">
                  {e.capture.method} {e.capture.path}
                  {e.capture.status === undefined ? "" : ` · ${e.capture.status}`}
                </span>
                <JsonInspectButton
                  title={`${e.transport === "mock" ? "Synthetic" : "Backend"} ${e.operation} · ${e.outcome}${e.tick === undefined ? "" : ` · tick ${e.tick}`}`}
                  onClick={() =>
                    setSelection({
                      capture: { ...e.capture! },
                      title: `${e.transport === "mock" ? "Synthetic" : "Backend"} ${e.operation} · ${e.outcome}${e.tick === undefined ? "" : ` · tick ${e.tick}`}`,
                    })
                  }
                />
              </div>
            )}
          </li>
        ))}
        {!entries.length && <li>Not observed</li>}
      </ol>
      <JsonViewer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}
