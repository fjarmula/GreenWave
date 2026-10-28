import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnSiteResult } from "@/components/hud/OnSiteResult";
import type { Station } from "@/types/telemetry";

const STATION: Station = {
  station_id: "STN-A-0004",
  vehicle_type: "AMBULANCE",
  source_kind: "prm_base",
  name: "Krakowskie Pogotowie Ratunkowe",
  position: { lat: 50.06, lng: 19.94 },
};

describe("OnSiteResult", () => {
  it("shows the on-site result as a simulated estimate with the way back", () => {
    const markup = renderToStaticMarkup(
      <OnSiteResult
        station={STATION}
        walk={{ access_point: STATION.position, distance_m: 120, seconds: 111 }}
        onBackToSetup={() => {}}
      />,
    );
    expect(markup).toContain("Incident at Krakowskie Pogotowie Ratunkowe");
    expect(markup).toContain(
      "No drive needed. On foot about 01m 51s (120 m) · simulated estimate.",
    );
    expect(markup).toMatch(/<button[^>]*>[\s\S]*Back to setup<\/button>/);
    expect(markup).toContain('role="status"');
  });

  it("reads 0 m for an incident on the station point", () => {
    const markup = renderToStaticMarkup(
      <OnSiteResult
        station={STATION}
        walk={{ access_point: STATION.position, distance_m: 0, seconds: 0 }}
        onBackToSetup={() => {}}
      />,
    );
    expect(markup).toContain("On foot about 00m 00s (0 m)");
  });
});
