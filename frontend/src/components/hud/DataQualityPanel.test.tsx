import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it, vi } from "vitest";

import {
  DATA_QUALITY_FOOTER,
  DATA_QUALITY_MOCK_NOTICE,
  DataQualityPanel,
  DataQualityView,
  createDataQualityLoader,
  type DataQualityState,
} from "@/components/hud/DataQualityPanel";
import { datasetQualityExample } from "@/lib/transport/__fixtures__/dataset-quality";
import { SimulationAdapterError } from "@/lib/transport/errors";

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/transport/dataset-quality", () => ({ fetchDatasetQuality: fetchSpy }));

const BASE = "http://127.0.0.1:8000";

function loader(mode: "mock" | "backend", fetchQuality = vi.fn(async () => datasetQualityExample)) {
  const states: DataQualityState[] = [];
  const created = createDataQualityLoader({
    mode,
    apiBaseUrl: BASE,
    fetchQuality,
    onChange: (state) => states.push(state),
  });
  return { created, fetchQuality, states };
}

describe("DataQualityPanel", () => {
  it("renders collapsed and does not fetch before it is expanded", () => {
    const markup = renderToStaticMarkup(<DataQualityPanel mode="backend" apiBaseUrl={BASE} />);

    expect(markup).toContain("<details");
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    expect(markup).toContain("Data quality");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the fixed notice in mock mode", () => {
    const markup = renderToStaticMarkup(<DataQualityPanel mode="mock" apiBaseUrl={BASE} />);

    expect(markup).toContain(DATA_QUALITY_MOCK_NOTICE);
    expect(DATA_QUALITY_MOCK_NOTICE).toBe("Available when connected to the simulation backend.");
  });
});

describe("createDataQualityLoader", () => {
  it("fetches on the first expand only", async () => {
    const { created, fetchQuality, states } = loader("backend");

    expect(fetchQuality).not.toHaveBeenCalled();
    await created.expand();
    await created.expand();

    expect(fetchQuality).toHaveBeenCalledTimes(1);
    expect(fetchQuality).toHaveBeenCalledWith(BASE, expect.any(AbortSignal));
    expect(states.map((state) => state.status)).toEqual(["loading", "loaded"]);
  });

  it("never fetches in mock mode", async () => {
    const { created, fetchQuality, states } = loader("mock");

    await created.expand();

    expect(fetchQuality).not.toHaveBeenCalled();
    expect(states).toEqual([]);
    expect(created.initialState).toEqual({ status: "mock" });
  });

  it("turns a failed fetch into an error state without throwing", async () => {
    const failing = vi.fn(async () => {
      throw new SimulationAdapterError({ kind: "http", status: 503, message: "HTTP 503" });
    });
    const { created, states } = loader("backend", failing);

    await expect(created.expand()).resolves.toBeUndefined();

    expect(states.at(-1)).toEqual({ status: "error", message: "HTTP 503" });
  });

  it("ignores a response that arrives after abort", async () => {
    const { created, states } = loader("backend");

    const pending = created.expand();
    created.abort();
    await pending;

    expect(states.map((state) => state.status)).toEqual(["loading"]);
  });
});

describe("DataQualityView", () => {
  it("shows one error line when the summary cannot be loaded", () => {
    const markup = renderToStaticMarkup(
      <DataQualityView state={{ status: "error", message: "HTTP 503" }} />,
    );

    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).toContain("HTTP 503");
    expect(markup).not.toContain(DATA_QUALITY_FOOTER);
  });

  it("wraps long source paths instead of overflowing the panel", () => {
    const markup = renderToStaticMarkup(
      <DataQualityView state={{ status: "loaded", data: datasetQualityExample }} />,
    );

    expect(markup).toMatch(/<span class="[^"]*break-all[^"]*">krakow\/Ulice\.geojson</);
  });

  it("renders every check, at most four metrics, the sources and the footer", async () => {
    const markup = renderToStaticMarkup(
      <DataQualityView state={{ status: "loaded", data: datasetQualityExample }} />,
    );

    for (const check of datasetQualityExample.checks) expect(markup).toContain(check.title);
    expect(markup).toContain("Warn");
    expect(markup).not.toContain("extra metric");
    expect(markup).toContain("Źródło: Urząd Miasta Krakowa / MSIP");
    expect(markup).toContain("2026-10-13 00:47:34");
    expect(markup).toContain(
      "Checks describe the source data used by the simulation. They do not verify physical signal states.",
    );
    await expect(`${markup}\n`).toMatchFileSnapshot("./__snapshots__/DataQualityPanel.loaded.html");
  });
});
