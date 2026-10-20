/**
 * Backend transport for the data quality summary (`GET /api/v1/dataset/quality`).
 * Failures become `SimulationAdapterError`: `network` when the backend cannot be
 * reached, `http` for an error status or an invalid body.
 */
import { SimulationAdapterError } from "@/lib/transport/errors";
import { unreachableMessage } from "@/lib/transport/backend-simulation-adapter";
import { validateDatasetQuality } from "@/lib/transport/validate";
import type { DatasetQualityResponse } from "@/types/telemetry";

export async function fetchDatasetQuality(
  apiBaseUrl: string,
  signal?: AbortSignal,
): Promise<DatasetQualityResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/dataset/quality`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    throw new SimulationAdapterError({ kind: "network", message: unreachableMessage(apiBaseUrl) });
  }
  if (!response.ok) {
    throw new SimulationAdapterError({
      kind: "http",
      status: response.status,
      message: `Data quality summary unavailable (HTTP ${response.status})`,
    });
  }
  const body: unknown = await response.json().catch(() => undefined);
  try {
    return validateDatasetQuality(body);
  } catch (error) {
    throw new SimulationAdapterError({
      kind: "http",
      status: response.status,
      message: `Backend sent an invalid data quality summary (${error instanceof Error ? error.message : "unknown field"})`,
    });
  }
}
