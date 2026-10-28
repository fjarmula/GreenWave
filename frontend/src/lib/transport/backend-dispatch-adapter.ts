import { beginHttpCapture } from "@/lib/diagnostics/wire-capture";
import type { Operation } from "@/lib/diagnostics/store";
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
  validateResources,
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
    const timeoutError = () =>
      new SimulationAdapterError({
        kind: "network",
        reason: "timeout",
        message: `Dispatch backend at ${baseUrl} did not answer within ${Math.round(options.timeoutMilliseconds / 1000)} s`,
      });
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMilliseconds);
    const operation: Operation = path.includes("/stations")
      ? "stations"
      : path.includes("/geocode")
        ? "geocode"
        : path.includes("/resources")
          ? "resources"
          : "ranking";
    const capture = beginHttpCapture(operation, {
      method: init.method === "POST" ? "POST" : "GET",
      path,
      ...(typeof init.body === "string" ? { requestBody: init.body } : {}),
    });
    try {
      let response: Response;
      let json: unknown;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { Accept: "application/json", ...init.headers },
          signal: controller.signal,
        });
        json = await capture.read(response);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw controller.signal.aborted
          ? timeoutError()
          : new SimulationAdapterError({ kind: "network", message: unreachableMessage(baseUrl) });
      }
      signal?.throwIfAborted();
      // The body read swallows its own abort: a timeout there must not look like a bad body.
      if (controller.signal.aborted) throw timeoutError();
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
        const result = validate(json);
        capture.accepted();
        return result;
      } catch (error) {
        capture.rejected();
        throw new SimulationAdapterError({
          kind: "http",
          status: response.status,
          message: `Backend sent an invalid ${what} (${error instanceof Error ? error.message : "unknown field"})`,
        });
      }
    } finally {
      if (signal?.aborted) capture.cancelled();
      else capture.failed(); // no-op once accepted or rejected
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  return {
    capabilities: { geocode: true, roadTimeRanking: true, resources: true },

    async listStations() {
      const body = await request(
        "/api/v1/stations",
        { method: "GET" },
        validateStations,
        "station list",
      );
      return body.stations;
    },

    listResources(at, signal) {
      return request(
        `/api/v1/resources?${new URLSearchParams({ at })}`,
        { method: "GET" },
        validateResources,
        "team roster",
        signal,
      );
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
