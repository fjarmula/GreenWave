export const operations = [
  "stations",
  "geocode",
  "ranking",
  "start",
  "sse",
  "stop",
  "quality",
  "its",
] as const;
export type Operation = (typeof operations)[number];
const outcomes = [
  "pending",
  "success",
  "failure",
  "tick",
  "completed",
  "cancelled",
  "connecting",
  "open",
  "reconnecting",
  "lost",
  "closed",
] as const;
export type DiagnosticEntry = {
  operation: Operation;
  transport: "mock" | "backend";
  outcome: (typeof outcomes)[number];
  durationMs?: number;
  tick?: number;
  count?: number;
};
export function createDiagnosticStore() {
  let entries: ReadonlyArray<DiagnosticEntry> = [];
  const listeners = new Set<() => void>();
  let scheduled = false;
  const notify = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      listeners.forEach((l) => {
        try {
          l();
        } catch {
          /* Diagnostics cannot interrupt transport. */
        }
      });
    });
  };
  return {
    record(input: DiagnosticEntry) {
      if (
        !operations.includes(input.operation) ||
        !outcomes.includes(input.outcome) ||
        (input.transport !== "mock" && input.transport !== "backend")
      )
        return;
      const entry: DiagnosticEntry = {
        operation: input.operation,
        transport: input.transport,
        outcome: input.outcome,
        count: 1,
      };
      if (Number.isFinite(input.durationMs) && input.durationMs! >= 0)
        entry.durationMs = input.durationMs;
      if (Number.isSafeInteger(input.tick) && input.tick! >= 0) entry.tick = input.tick;
      const last = entries.at(-1);
      if (
        entry.outcome === "tick" &&
        last?.outcome === "tick" &&
        last.transport === entry.transport
      ) {
        entry.count = (last.count ?? 1) + 1;
        entries = [...entries.slice(0, -1), entry];
      } else entries = [...entries.slice(-199), entry];
      notify();
    },
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      entries = [];
      notify();
    },
  };
}
export const diagnosticStore = createDiagnosticStore();
