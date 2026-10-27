import { describe, expect, it } from "vitest";

import { addressFromResult, provenanceBadge, provenanceStrip } from "@/lib/address-provenance";
import type { IncidentAddress } from "@/lib/useIncidentDispatch";

const OSM_POSITION = { lat: 50.051, lng: 19.965 };

function address(overrides: Partial<IncidentAddress>): IncidentAddress {
  return {
    provenance: "matched",
    osmDeltaM: null,
    disagreementM: null,
    osmPosition: null,
    osmSameKeyElsewhere: false,
    ...overrides,
  };
}

describe("address provenance copy", () => {
  it("matched without disagreement", () => {
    const clean = address({ osmDeltaM: 40.4 });
    expect(provenanceBadge(clean)).toEqual({ text: "EMUiA · Verified", tone: "go" });
    expect(provenanceStrip(clean)).toEqual({
      lines: ["Coordinate source: Kraków EMUiA", "OSM cross-check: 40 m delta"],
      warning: null,
    });
  });

  it("matched with a disagreement", () => {
    const far = address({ osmDeltaM: 249.6, disagreementM: 249.6, osmPosition: OSM_POSITION });
    expect(provenanceBadge(far)).toEqual({ text: "EMUiA · ⚠ 250m delta", tone: "caution" });
    expect(provenanceStrip(far)).toEqual({
      lines: ["Coordinate source: Kraków EMUiA"],
      warning: "Kraków EMUiA and OSM differ by 250 m. Routing to official EMUiA coordinate.",
    });
  });

  it("municipal only", () => {
    const gap = address({ provenance: "municipal" });
    expect(provenanceBadge(gap)).toEqual({ text: "EMUiA Only", tone: "beacon" });
    expect(provenanceStrip(gap)).toEqual({
      lines: [
        "Coordinate source: Kraków EMUiA",
        "Present in Kraków EMUiA; missing in OpenStreetMap",
      ],
      warning: null,
    });
  });

  it("municipal whose key OSM has elsewhere makes no missing claim", () => {
    const elsewhere = address({ provenance: "municipal", osmSameKeyElsewhere: true });
    expect(provenanceBadge(elsewhere)).toEqual({ text: "EMUiA Only", tone: "beacon" });
    expect(provenanceStrip(elsewhere)).toEqual({
      lines: ["Coordinate source: Kraków EMUiA"],
      warning: null,
    });
  });

  it("OSM fallback", () => {
    const osm = address({ provenance: "osm" });
    expect(provenanceBadge(osm)).toEqual({ text: "OSM Fallback", tone: "muted" });
    expect(provenanceStrip(osm)).toEqual({
      lines: ["Coordinate source: OSM fallback"],
      warning: null,
    });
  });

  it("reads a geocode result, treating absent optional fields as null", () => {
    expect(
      addressFromResult({
        label: "Zabłocie 18",
        position: { lat: 50.05, lng: 19.96 },
        provenance: "matched",
        osm_delta_m: 442,
        disagreement_m: 442,
        osm_position: OSM_POSITION,
        osm_same_key_elsewhere: false,
      }),
    ).toEqual(address({ osmDeltaM: 442, disagreementM: 442, osmPosition: OSM_POSITION }));
    expect(
      addressFromResult({
        label: "A 1",
        position: { lat: 50, lng: 19.9 },
        provenance: "osm",
        osm_same_key_elsewhere: false,
      }),
    ).toEqual(address({ provenance: "osm" }));
  });
});
