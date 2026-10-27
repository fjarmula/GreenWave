import type { IncidentAddress } from "@/lib/useIncidentDispatch";
import type { GeocodeResult } from "@/types/telemetry";

/** Tone classes of the badge: `tone-go`, `tone-caution`, `tone-beacon`, or muted text. */
export type BadgeTone = "go" | "caution" | "beacon" | "muted";

const EMUIA_SOURCE = "Coordinate source: Kraków EMUiA";

function metres(value: number): number {
  return Math.round(value);
}

/** The provenance fields of a geocode result; absent optional fields become `null`. */
export function addressFromResult(result: GeocodeResult): IncidentAddress {
  return {
    provenance: result.provenance,
    osmDeltaM: result.osm_delta_m ?? null,
    disagreementM: result.disagreement_m ?? null,
    osmPosition: result.osm_position ?? null,
    osmSameKeyElsewhere: result.osm_same_key_elsewhere ?? false,
  };
}

/** The suggestion badge (ADR 0013 copy). */
export function provenanceBadge(address: IncidentAddress): { text: string; tone: BadgeTone } {
  switch (address.provenance) {
    case "matched":
      return address.disagreementM === null
        ? { text: "EMUiA · Verified", tone: "go" }
        : { text: `EMUiA · ⚠ ${metres(address.disagreementM)}m delta`, tone: "caution" };
    case "municipal":
      return { text: "EMUiA Only", tone: "beacon" };
    case "osm":
      return { text: "OSM Fallback", tone: "muted" };
  }
}

/**
 * The strip under the incident input for a selected address. A municipal record whose street
 * and number OSM has elsewhere makes no "missing in OpenStreetMap" claim.
 */
export function provenanceStrip(address: IncidentAddress): {
  lines: string[];
  warning: string | null;
} {
  switch (address.provenance) {
    case "matched":
      if (address.disagreementM !== null) {
        const delta = metres(address.disagreementM);
        return {
          lines: [EMUIA_SOURCE],
          warning: `Kraków EMUiA and OSM differ by ${delta} m. Routing to official EMUiA coordinate.`,
        };
      }
      return {
        lines:
          address.osmDeltaM === null
            ? [EMUIA_SOURCE]
            : [EMUIA_SOURCE, `OSM cross-check: ${metres(address.osmDeltaM)} m delta`],
        warning: null,
      };
    case "municipal":
      return {
        lines: address.osmSameKeyElsewhere
          ? [EMUIA_SOURCE]
          : [EMUIA_SOURCE, "Present in Kraków EMUiA; missing in OpenStreetMap"],
        warning: null,
      };
    case "osm":
      return { lines: ["Coordinate source: OSM fallback"], warning: null };
  }
}
