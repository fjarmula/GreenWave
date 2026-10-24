import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import type { DispatchRankResponse, Station } from "@/types/telemetry";

const station = (id: string, name: string, kind: Station["source_kind"]): Station => ({
  station_id: id,
  vehicle_type: "AMBULANCE",
  source_kind: kind,
  name,
  position: { lat: 50.06, lng: 19.94 },
});

const RANKING: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50.0617, lng: 19.9373 }, snap_distance_m: 3 },
  candidates: [
    {
      station: station("STN-A-0006", "SP ZOZ MSW", "hospital_ed"),
      greenwave_seconds: 248.4,
      distance_m: 2810,
    },
    {
      station: station("STN-A-0007", "5. Wojskowy", "hospital_ed"),
      greenwave_seconds: 289,
      distance_m: 3403,
    },
    {
      station: station("STN-A-0004", "KPR", "ambulance_base"),
      greenwave_seconds: 349,
      distance_m: 4592,
    },
  ],
  station_at_incident: null,
};

const render = (props: Partial<Parameters<typeof StationRanking>[0]> = {}) =>
  renderToStaticMarkup(
    <StationRanking
      ranking={RANKING}
      rankStatus="ready"
      rankError={null}
      roadTimeRanking
      selectedStationId={null}
      onSelect={() => {}}
      {...props}
    />,
  );

describe("StationRanking", () => {
  it("shows the winner and two runners-up with their times", () => {
    const markup = render();
    expect(markup).toContain("SP ZOZ MSW");
    expect(markup).toContain("5. Wojskowy");
    expect(markup).toContain("KPR");
    expect(markup).toContain("04m 08s");
    expect(markup).toContain("04m 49s");
    expect(markup).toContain("05m 49s");
  });

  it("keeps each truncated station name readable in full on hover", () => {
    const markup = render();
    for (const name of ["SP ZOZ MSW", "5. Wojskowy", "KPR"]) {
      expect(markup).toMatch(new RegExp(`<span class="[^"]*truncate[^"]*" title="${name}">`));
    }
  });

  it("names hospital emergency departments as such", () => {
    expect(render()).toContain("Hospital emergency dept.");
    expect(render()).toContain("Ambulance base");
  });

  it("explains a station at the incident", () => {
    const markup = render({
      ranking: { ...RANKING, station_at_incident: station("STN-A-0001", "Here", "ambulance_base") },
    });
    expect(markup).toContain(
      "A station of this type is at this location; dispatching from the next fastest.",
    );
  });

  it("renders a radio per candidate", () => {
    const markup = render();
    expect(markup).toContain("<fieldset");
    expect(markup).toMatch(/<legend[^>]*>[\s\S]*Dispatch from/);
    const names = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
      ([input]) => /name="([^"]+)"/.exec(input)?.[1],
    );
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(1);
  });

  it("checks the fastest by default", () => {
    const checked = (markup: string) =>
      [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)]
        .filter(([input]) => /\schecked=""/.test(input))
        .map(([input]) => /value="([^"]+)"/.exec(input)?.[1]);
    expect(checked(render())).toEqual(["STN-A-0006"]);
    expect(checked(render({ selectedStationId: "STN-A-0007" }))).toEqual(["STN-A-0007"]);
  });

  it("shows deltas against the fastest", () => {
    const markup = render();
    expect(markup).toContain("+41 s");
    expect(markup).toContain("+101 s");
    const mock = render({ roadTimeRanking: false });
    expect(mock).toContain("+0.6 km");
    expect(mock).toContain("+1.8 km");
  });

  it("badges the fastest", () => {
    expect(render().match(/Fastest/g)).toHaveLength(1);
    expect(render({ selectedStationId: "STN-A-0004" }).match(/Fastest/g)).toHaveLength(1);
  });

  it("single candidate renders one checked radio", () => {
    const markup = render({ ranking: { ...RANKING, candidates: [RANKING.candidates[0]] } });
    const radios = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)];
    expect(radios).toHaveLength(1);
    expect(radios[0][0]).toMatch(/\schecked=""/);
    expect(markup).not.toContain("+");
  });

  it("labels the mock choice approximate and shows no times", () => {
    const markup = render({
      roadTimeRanking: false,
      ranking: { ...RANKING, candidates: [{ ...RANKING.candidates[0], greenwave_seconds: 0 }] },
    });
    expect(markup).toContain("Approximate (mock)");
    expect(markup).not.toMatch(/\d\dm \d\ds/);
  });

  it("shows the error copy", () => {
    const markup = render({
      ranking: null,
      rankStatus: "error",
      rankError: "Location is off the road network",
    });
    expect(markup).toContain("Location is off the road network");
    expect(markup).toContain('role="alert"');
  });

  it("shows progress while ranking", () => {
    expect(render({ ranking: null, rankStatus: "loading" })).toContain("Ranking stations");
  });
});
