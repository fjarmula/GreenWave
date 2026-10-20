import { afterEach, describe, expect, it, vi } from "vitest";

import { datasetQualityExample } from "@/lib/transport/__fixtures__/dataset-quality";
import { fetchDatasetQuality } from "@/lib/transport/dataset-quality";
import { SimulationAdapterError } from "@/lib/transport/errors";

const BASE = "http://127.0.0.1:8000";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchDatasetQuality", () => {
  it("returns the validated summary from GET /api/v1/dataset/quality", async () => {
    const fetchMock = respond(200, datasetQualityExample);

    await expect(fetchDatasetQuality(BASE)).resolves.toEqual(datasetQualityExample);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v1/dataset/quality`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws an http transport error on a non-200 status", async () => {
    respond(503, { detail: "unavailable" });

    const error = await fetchDatasetQuality(BASE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SimulationAdapterError);
    expect(error).toMatchObject({ kind: "http", status: 503 });
  });

  it("throws a network transport error when the backend is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(fetchDatasetQuality(BASE)).rejects.toMatchObject({ kind: "network" });
  });

  it("throws a transport error when the body is not simulated data", async () => {
    respond(200, { ...datasetQualityExample, is_simulated: false });

    await expect(fetchDatasetQuality(BASE)).rejects.toMatchObject({
      kind: "http",
      message: expect.stringContaining("is_simulated"),
    });
  });

  it("passes the abort signal to fetch", async () => {
    const fetchMock = respond(200, datasetQualityExample);
    const controller = new AbortController();

    await fetchDatasetQuality(BASE, controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
