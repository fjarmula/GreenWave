import { beginHttpCapture } from "@/lib/diagnostics/wire-capture";
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
  const capture = beginHttpCapture("quality", { method: "GET", path: "/api/v1/dataset/quality" });
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/dataset/quality`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    capture.failed();
    throw new SimulationAdapterError({ kind: "network", message: unreachableMessage(apiBaseUrl) });
  }
  const body = await capture.read(response);
  if (!response.ok) {
    capture.failed();
    throw new SimulationAdapterError({
      kind: "http",
      status: response.status,
      message: `Data quality summary unavailable (HTTP ${response.status})`,
    });
  }
  try {
    const result = validateDatasetQuality(body);
    capture.accepted();
    return result;
  } catch (error) {
    capture.rejected();
    throw new SimulationAdapterError({
      kind: "http",
      status: response.status,
      message: `Backend sent an invalid data quality summary (${error instanceof Error ? error.message : "unknown field"})`,
    });
  }
}
