import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncidentInput } from "@/components/hud/dispatch/IncidentInput";
import {
  createAddressSearch,
  GEOCODE_DEBOUNCE_MILLISECONDS,
  suggestionToIncident,
} from "@/lib/address-search";
import type { GeocodeResult } from "@/types/telemetry";

const RESULT: GeocodeResult = { label: "Floriańska 1", position: { lat: 50.0624, lng: 19.9395 } };

afterEach(() => vi.useRealTimers());

describe("createAddressSearch", () => {
  it("does not search for a single character", async () => {
    vi.useFakeTimers();
    const geocode = vi.fn(async () => [RESULT]);
    const search = createAddressSearch(geocode);

    search.setQuery("f");
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MILLISECONDS * 2);

    expect(geocode).not.toHaveBeenCalled();
    expect(search.getState()).toEqual({ results: [], status: "idle" });
  });

  it("searches once, 250 ms after the last keystroke of 2+ characters", async () => {
    vi.useFakeTimers();
    const geocode = vi.fn(async () => [RESULT]);
    const search = createAddressSearch(geocode);

    search.setQuery("fl");
    await vi.advanceTimersByTimeAsync(100);
    search.setQuery("flo");
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MILLISECONDS - 1);
    expect(geocode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(GEOCODE_DEBOUNCE_MILLISECONDS).toBe(250);
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith("flo", expect.any(AbortSignal));
    expect(search.getState()).toEqual({ results: [RESULT], status: "ready" });
  });

  it("discards a slower older search", async () => {
    vi.useFakeTimers();
    const resolvers: Array<(results: GeocodeResult[]) => void> = [];
    const geocode = vi.fn<(query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>>(
      () => new Promise<GeocodeResult[]>((resolve) => resolvers.push(resolve)),
    );
    const search = createAddressSearch(geocode);

    search.setQuery("flo");
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MILLISECONDS);
    search.setQuery("dlu");
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MILLISECONDS);
    expect(geocode.mock.calls[0][1]?.aborted).toBe(true);
    resolvers[1]([{ ...RESULT, label: "Długa 1" }]);
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]([RESULT]);
    await vi.advanceTimersByTimeAsync(0);

    expect(search.getState().results.map((r) => r.label)).toEqual(["Długa 1"]);
  });

  it("clears the results when the query becomes too short", async () => {
    vi.useFakeTimers();
    const search = createAddressSearch(async () => [RESULT]);
    search.setQuery("flo");
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MILLISECONDS);

    search.setQuery("f");

    expect(search.getState()).toEqual({ results: [], status: "idle" });
  });
});

describe("suggestionToIncident", () => {
  it("makes an address incident", () => {
    expect(suggestionToIncident(RESULT)).toEqual({
      position: RESULT.position,
      label: "Floriańska 1",
      source: "address",
    });
  });
});

describe("IncidentInput markup", () => {
  const render = (geocodeEnabled: boolean) =>
    renderToStaticMarkup(
      <IncidentInput
        incident={null}
        geocodeEnabled={geocodeEnabled}
        geocode={async () => []}
        onIncidentChange={() => undefined}
      />,
    );

  it("disables address search without the backend", () => {
    const markup = render(false);
    expect(markup).toContain("Address search needs the backend");
    expect(markup).toMatch(/<input[^>]* disabled=""/);
    expect(markup).toContain("or click the map");
  });

  it("offers address search with the backend", () => {
    const markup = render(true);
    expect(markup).not.toContain("Address search needs the backend");
    expect(markup).not.toMatch(/<input[^>]* disabled=""/);
    expect(markup).toContain("or click the map");
    expect(markup).toContain('role="combobox"');
  });

  it("shows the pinned incident label", () => {
    const markup = renderToStaticMarkup(
      <IncidentInput
        incident={{
          position: { lat: 50.0614, lng: 19.9366 },
          label: "Pinned 50.0614, 19.9366",
          source: "map",
        }}
        geocodeEnabled
        geocode={async () => []}
        onIncidentChange={() => undefined}
      />,
    );
    expect(markup).toContain('value="Pinned 50.0614, 19.9366"');
  });
});
