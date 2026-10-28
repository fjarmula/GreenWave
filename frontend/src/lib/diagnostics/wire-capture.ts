import { diagnosticStore, type DiagnosticCapture, type Operation } from "./store";

/** Observe the existing request; no extra fetch, headers, or persistent storage. */
export function beginHttpCapture(operation: Operation, request: DiagnosticCapture) {
  const started = performance.now();
  diagnosticStore.record({ operation, transport: "backend", outcome: "pending", capture: request });
  let finished = false;
  let capture = request;
  const finish = (
    outcome: "success" | "failure" | "cancelled",
    validation?: "accepted" | "rejected",
  ) => {
    if (finished) return;
    finished = true;
    diagnosticStore.record({
      operation,
      transport: "backend",
      outcome,
      durationMs: Math.max(0, performance.now() - started),
      capture: { ...capture, ...(validation ? { validation } : {}) },
    });
  };
  return {
    async read(response: Response): Promise<unknown> {
      const responseBody = await response.text().catch(() => undefined);
      capture = {
        ...request,
        status: response.status,
        ...(responseBody === undefined ? { responseOmitted: true } : { responseBody }),
      };
      try {
        return responseBody === undefined ? undefined : JSON.parse(responseBody);
      } catch {
        return undefined;
      }
    },
    accepted(validated = true) {
      finish("success", validated ? "accepted" : undefined);
    },
    rejected() {
      finish("failure", "rejected");
    },
    failed() {
      finish("failure");
    },
    /** The caller abandoned the request (superseded); not a failure of the backend. */
    cancelled() {
      finish("cancelled");
    },
  };
}
