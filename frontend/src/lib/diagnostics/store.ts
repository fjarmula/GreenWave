export const operations = [
  "stations",
  "geocode",
  "ranking",
  "start",
  "compare-start",
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
export type DiagnosticCapture = {
  method: "GET" | "POST";
  path: string;
  status?: number;
  eventType?: string;
  validation?: "accepted" | "rejected";
  requestBody?: string;
  responseBody?: string;
  requestOmitted?: boolean;
  responseOmitted?: boolean;
};
export const CAPTURE_BODY_LIMIT = 2 * 1024 * 1024;
export const CAPTURE_HISTORY_LIMIT = 8 * 1024 * 1024;
const textBytes = (value = "") => new TextEncoder().encode(value).byteLength;
const captureSizes = new WeakMap<DiagnosticCapture, number>();
function captureBytes(capture?: DiagnosticCapture) {
  if (!capture) return 0;
  const cached = captureSizes.get(capture);
  if (cached !== undefined) return cached;
  const size =
    textBytes(capture.path) + textBytes(capture.requestBody) + textBytes(capture.responseBody);
  captureSizes.set(capture, size);
  return size;
}
function boundedCapture(input: DiagnosticCapture): DiagnosticCapture {
  const capture: DiagnosticCapture = {
    method: input.method,
    path: input.path.length <= 8192 ? input.path : "[Endpoint omitted: capture limit exceeded]",
  };
  if (input.status !== undefined) capture.status = input.status;
  if (input.eventType) capture.eventType = input.eventType;
  if (input.validation) capture.validation = input.validation;
  for (const side of ["request", "response"] as const) {
    const body = input[`${side}Body`];
    if (input[`${side}Omitted`] || (body !== undefined && textBytes(body) > CAPTURE_BODY_LIMIT))
      capture[`${side}Omitted`] = true;
    else if (body !== undefined) capture[`${side}Body`] = body;
  }
  return capture;
}
export type DiagnosticEntry = {
  operation: Operation;
  transport: "mock" | "backend";
  outcome: (typeof outcomes)[number];
  durationMs?: number;
  tick?: number;
  count?: number;
  capture?: DiagnosticCapture;
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
      if (input.capture) entry.capture = boundedCapture(input.capture);
      const last = entries.at(-1);
      if (
        entry.outcome === "tick" &&
        last?.outcome === "tick" &&
        last.transport === entry.transport &&
        last.operation === entry.operation
      ) {
        entry.count = (last.count ?? 1) + 1;
        entries = [...entries.slice(0, -1), entry];
      } else entries = [...entries.slice(-199), entry];
      let retainedBytes = entries.reduce((sum, item) => sum + captureBytes(item.capture), 0);
      while (retainedBytes > CAPTURE_HISTORY_LIMIT && entries.length > 1) {
        retainedBytes -= captureBytes(entries[0].capture);
        entries = entries.slice(1);
      }
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
