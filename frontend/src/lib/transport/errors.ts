import type { ErrorCode } from "@/types/telemetry";

/**
 * Serializable description of an adapter failure. `network` = the backend
 * could not be reached (refused, DNS, timeout, stream retries exhausted);
 * `http` = the backend answered with an error status or an invalid body.
 * `code` is present only when the body was a contract `ErrorResponse`.
 */
export type SimulationErrorInfo = {
  kind: "network" | "http";
  code?: ErrorCode;
  status?: number;
  message: string;
};

export class SimulationAdapterError extends Error implements SimulationErrorInfo {
  readonly kind: SimulationErrorInfo["kind"];
  readonly code?: ErrorCode;
  readonly status?: number;

  constructor(info: SimulationErrorInfo) {
    super(info.message);
    this.name = "SimulationAdapterError";
    this.kind = info.kind;
    this.code = info.code;
    this.status = info.status;
  }

  toInfo(): SimulationErrorInfo {
    return { kind: this.kind, code: this.code, status: this.status, message: this.message };
  }
}

/** Normalizes anything thrown by an adapter into plain, reducer-safe error info. */
export function toSimulationErrorInfo(error: unknown): SimulationErrorInfo {
  if (error instanceof SimulationAdapterError) return error.toInfo();
  return {
    kind: "network",
    message: error instanceof Error ? error.message : "Unknown simulation transport error",
  };
}
