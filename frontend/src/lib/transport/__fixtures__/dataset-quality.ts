/** A `GET /api/v1/dataset/quality` body, typed against the generated contract. */
import type { DatasetQualityResponse } from "@/types/telemetry";

export const datasetQualityExample: DatasetQualityResponse = {
  schema_version: "1.0",
  is_simulated: true,
  manifest_sha256: "a".repeat(64),
  msip_export_timestamp: "2026-10-13 00:47:34",
  checks: [
    {
      id: "near_misses",
      title: "Near misses",
      status: "warn",
      headline: "106 near misses remain after welding; 19 involve tertiary-or-higher roads.",
      metrics: { near_misses_after_welding: 106, tertiary_plus_cases: 19 },
      samples: ["unnamed (service) / Świętego Rafała Kalinowskiego (tertiary): 0.1 m gap"],
    },
    {
      id: "street_lengths",
      title: "Street lengths vs city register",
      status: "info",
      headline: "65% of 2733 streets matched by name have an OSM length within range.",
      metrics: {
        streets_compared: 2733,
        share_within_range: 0.65,
        ulice_only_streets: 120,
        graph_only_streets: 270,
        extra_metric: 1,
      },
      samples: [],
    },
    {
      id: "route_sanity",
      title: "Route sanity",
      status: "pass",
      headline: "5 of 5 shortest routes between named places are within range.",
      metrics: { routes_checked: 5, routes_within_range: 5, max_detour_ratio: 1.547 },
      samples: ["Rondo Mogilskie → Rondo Grunwaldzkie: detour ratio 1.28"],
    },
  ],
  sources: [
    {
      path: "krakow/Ulice.geojson",
      source: "Krakow open data (MSIP/ZDMK export)",
      licence: "Polish Open Data Act",
      attribution: "Źródło: Urząd Miasta Krakowa / MSIP",
      retrieved_on: "2026-10-13",
    },
  ],
};
