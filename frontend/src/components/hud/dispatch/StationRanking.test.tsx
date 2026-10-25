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
      standard_seconds: 301.2,
      distance_m: 2810,
      on_site: false,
    },
    {
      station: station("STN-A-0007", "5. Wojskowy", "hospital_ed"),
      greenwave_seconds: 289,
      standard_seconds: 342,
      distance_m: 3403,
      on_site: false,
    },
    {
      station: station("STN-A-0004", "KPR", "ambulance_base"),
      greenwave_seconds: 349,
      standard_seconds: 401,
      distance_m: 4592,
      on_site: false,
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
      timeMode="GREENWAVE"
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

  it("no longer shows the station-at-incident notice", () => {
    const markup = render({
      ranking: { ...RANKING, station_at_incident: station("STN-A-0001", "Here", "ambulance_base") },
    });
    expect(markup).not.toContain("A station of this type is at this location");
  });

  it('shows "On site" and the walk for an on-site candidate', () => {
    const [a, b] = RANKING.candidates;
    const onSite = {
      ...a,
      greenwave_seconds: 0,
      standard_seconds: 0,
      distance_m: 0,
      on_foot: { access_point: a.station.position, distance_m: 120, seconds: 111 },
      on_site: true,
    };
    for (const timeMode of ["GREENWAVE", "STANDARD", "BOTH"] as const) {
      const markup = render({ ranking: { ...RANKING, candidates: [onSite, b] }, timeMode });
      expect(markup).toContain("On site");
      expect(markup).not.toContain("Fastest"); // one chip, so the name keeps its room
      expect(markup).toContain("on foot · 120 m");
      expect(markup).toContain("01m 51s");
      expect(markup).not.toContain("drive +");
      expect(markup).not.toContain("GW 01m 51s");
    }
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

  const LEG = { access_point: { lat: 50.06, lng: 19.91 }, distance_m: 650, seconds: 464 };

  it("shows the total time", () => {
    const markup = render({
      ranking: {
        ...RANKING,
        candidates: [{ ...RANKING.candidates[0], greenwave_seconds: 140, on_foot: LEG }],
      },
    });
    expect(markup).toContain("10m 04s");
    expect(markup).toContain("02m 20s drive + 07m 44s on foot · 650 m");
  });

  const twoModes = (patch: Partial<DispatchRankResponse["candidates"][number]> = {}) => ({
    ...RANKING,
    candidates: [
      { ...RANKING.candidates[0], greenwave_seconds: 310, standard_seconds: 422, ...patch },
    ],
  });

  it("shows the standard time on the standard page", () => {
    const markup = render({ ranking: twoModes(), timeMode: "STANDARD" });
    expect(markup).toContain("07m 02s");
    expect(markup).not.toContain("05m 10s");
  });

  it("marks the standard-fastest candidate on the standard page", () => {
    const [a, b, c] = RANKING.candidates;
    const markup = render({
      timeMode: "STANDARD",
      ranking: {
        ...RANKING,
        candidates: [
          { ...a, greenwave_seconds: 200, standard_seconds: 500 },
          { ...b, greenwave_seconds: 250, standard_seconds: 300 },
          { ...c, greenwave_seconds: 300, standard_seconds: 400 },
        ],
      },
    });
    const fastest = markup.indexOf("Fastest");
    expect(markup.indexOf("5. Wojskowy")).toBeLessThan(fastest);
    expect(markup.indexOf("KPR")).toBeGreaterThan(fastest);
    expect(markup.indexOf("SP ZOZ MSW")).toBeGreaterThan(markup.indexOf("KPR"));
    expect(markup).toContain("+100 s");
    expect(markup).toContain("+200 s");
  });

  it("checks the standard-fastest by default on the standard page", () => {
    const [a, b] = RANKING.candidates;
    const markup = render({
      timeMode: "STANDARD",
      ranking: {
        ...RANKING,
        candidates: [
          { ...a, greenwave_seconds: 200, standard_seconds: 500 },
          { ...b, greenwave_seconds: 250, standard_seconds: 300 },
        ],
      },
    });
    const checked = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)]
      .filter(([input]) => /\schecked=""/.test(input))
      .map(([input]) => /value="([^"]+)"/.exec(input)?.[1]);
    expect(checked).toEqual([b.station.station_id]);
  });

  it("shows both times on the comparison page", () => {
    const markup = render({ ranking: twoModes(), timeMode: "BOTH" });
    expect(markup).toContain("GW");
    expect(markup).toContain("05m 10s");
    expect(markup).toContain("07m 02s");
    expect(markup).toContain("Std");
  });

  it("splits drive and walk for an off-road candidate", () => {
    const markup = render({
      ranking: twoModes({ on_foot: { ...LEG, seconds: 550 } }),
      timeMode: "STANDARD",
    });
    expect(markup).toContain("16m 12s");
    expect(markup).toContain("07m 02s drive + 09m 10s on foot · 650 m");
  });

  it("measures deltas on the totals", () => {
    const [a, b] = RANKING.candidates;
    const markup = render({
      ranking: {
        ...RANKING,
        candidates: [
          { ...a, greenwave_seconds: 300, on_foot: { ...LEG, seconds: 100 } }, // 400
          { ...b, greenwave_seconds: 200, on_foot: { ...LEG, seconds: 260 } }, // 460
        ],
      },
    });
    expect(markup).toContain("+60 s");
    expect(markup).not.toContain("incl. 0 m");
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
