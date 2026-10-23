import type { DiagnosticEntry } from "./store";

export function diagnosticOutcomeLabel(entry: DiagnosticEntry): string {
  // Also clarify older entries retained in this browser's in-memory history.
  if (
    (entry.operation === "its" || entry.operation === "its-feedback") &&
    (entry.outcome === "success" || entry.outcome === "received")
  )
    return "event received";
  return entry.outcome;
}

export function diagnosticTickLabel(tick: number | undefined): string {
  return tick === undefined ? "" : ` · tick ${tick} (${tick} s simulated)`;
}

export function diagnosticTitle(entry: DiagnosticEntry): string {
  const transport = entry.transport === "mock" ? "Synthetic" : "Backend";
  const type =
    entry.operation === "its"
      ? "ITS_DISPATCH"
      : entry.operation === "its-feedback"
        ? "ITS_FEEDBACK"
        : null;
  const outcome = diagnosticOutcomeLabel(entry);
  return type
    ? `${transport} · ${type} ${outcome === "event received" ? "received" : outcome}${diagnosticTickLabel(entry.tick)}`
    : `${transport} ${entry.operation} · ${outcome}${diagnosticTickLabel(entry.tick)}`;
}
