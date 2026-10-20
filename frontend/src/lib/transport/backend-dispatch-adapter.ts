/**
 * Backend transport for incident dispatch (ADR 0006): `GET /api/v1/stations`,
 * `GET /api/v1/geocode`, `POST /api/v1/dispatch/rank`. Failures become
 * `SimulationAdapterError` (`network`: unreachable or timed out; `http`: an error
 * status, with the contract `error_code` when present, or an invalid body). A
 * request aborted by the caller rejects with the platform `AbortError` instead, so
 * a superseded search or ranking is never shown as a failure.
 */
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { unreachableMessage } from "@/lib/transport/backend-simulation-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import {
  parseErrorResponse,
  validateGeocode,
  validateRank,
  validateStations,
} from "@/lib/transport/validate";

export type BackendDispatchOptions = { timeoutMilliseconds: number };

export function createBackendDispatchAdapter(
  baseUrl: string,
  options: BackendDispatchOptions,
): DispatchAdapter {
  async function request<T>(
    path: string,
    init: RequestInit,
    validate: (body: unknown) => T,
    what: string,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMilliseconds);
    try {
      let response: Response;
      let json: unknown;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { Accept: "application/json", ...init.headers },
          signal: controller.signal,
        });
        json = await response.json().catch(() => undefined);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new SimulationAdapterError(
          controller.signal.aborted
            ? {
                kind: "network",
                reason: "timeout",
                message: `Dispatch backend at ${baseUrl} did not answer within ${Math.round(options.timeoutMilliseconds / 1000)} s`,
              }
            : { kind: "network", message: unreachableMessage(baseUrl) },
        );
      }
      signal?.throwIfAborted();
      if (!response.ok) {
        const error = parseErrorResponse(json);
        throw new SimulationAdapterError({
          kind: "http",
          status: response.status,
          code: error?.error_code,
          message: error?.message ?? `${what} failed (HTTP ${response.status})`,
        });
      }
      try {
        return validate(json);
      } catch (error) {
        throw new SimulationAdapterError({
          kind: "http",
          status: response.status,
          message: `Backend sent an invalid ${what} (${error instanceof Error ? error.message : "unknown field"})`,
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  return {
    capabilities: { geocode: true, roadTimeRanking: true },

    async listStations() {
      const body = await request(
        "/api/v1/stations",
        { method: "GET" },
        validateStations,
        "station list",
      );
      return body.stations;
    },

    async geocode(query, signal) {
      const params = new URLSearchParams({ q: query });
      const body = await request(
        `/api/v1/geocode?${params}`,
        { method: "GET" },
        validateGeocode,
        "address search",
        signal,
      );
      return body.results;
    },

    rank(rankRequest, signal) {
      return request(
        "/api/v1/dispatch/rank",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rankRequest),
        },
        validateRank,
        "station ranking",
        signal,
      );
    },
  };
}
