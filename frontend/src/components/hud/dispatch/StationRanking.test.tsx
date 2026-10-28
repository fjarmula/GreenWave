import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it } from "vitest";

import { StationRanking } from "@/components/hud/dispatch/StationRanking";
import {
  NO_ELIGIBLE_RANK,
  RESOURCES,
  TEAM_RANK,
  TEAM_RANK_WITH_WALK,
} from "@/lib/transport/__fixtures__/team-dispatch";
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
      station: station("STN-A-0006", "SP ZOZ MSW", "prm_base"),
      greenwave_seconds: 248.4,
      standard_seconds: 301.2,
      distance_m: 2810,
      on_site: false,
    },
    {
      station: station("STN-A-0007", "5. Wojskowy", "prm_base"),
      greenwave_seconds: 289,
      standard_seconds: 342,
      distance_m: 3403,
      on_site: false,
    },
    {
      station: station("STN-A-0004", "KPR", "prm_base"),
      greenwave_seconds: 349,
      standard_seconds: 401,
      distance_m: 4592,
      on_site: false,
    },
  ],
  scenario_time: "2026-10-27T12:00:00",
  outcome: "OK",
  incident_area: null,
  excluded_teams: [],
  roster: null,
  area_rule: null,
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

  it("keeps the full station name available without truncation", () => {
    const markup = render();
    for (const name of ["SP ZOZ MSW", "5. Wojskowy", "KPR"]) {
      expect(markup).toMatch(
        new RegExp(`<span class="[^"]*station-choice-name[^"]*" title="${name}">`),
      );
    }
  });

  it("names PRM team bases as such", () => {
    expect(render()).toContain("PRM team base");
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

describe("StationRanking with PRM teams (ADR 0014)", () => {
  const teamMarkup = (props: Partial<Parameters<typeof StationRanking>[0]> = {}) =>
    render({ ranking: TEAM_RANK, teams: RESOURCES.teams, ...props });

  it("keeps the recommended team first and puts Fastest on a later row", () => {
    const markup = teamMarkup();
    const recommended = markup.indexOf("Recommended");
    const fastest = markup.indexOf("Fastest");

    expect(markup.indexOf("K01 008")).toBeLessThan(markup.indexOf("K01 001"));
    expect(recommended).toBeGreaterThan(-1);
    expect(recommended).toBeLessThan(markup.indexOf("K01 001"));
    // The chip follows the second row's station name, after the whole first row.
    expect(fastest).toBeGreaterThan(markup.indexOf("ul. św. Łazarza 14"));
    expect(fastest).toBeGreaterThan(markup.indexOf("K01 008"));
    expect(markup).toContain("+40 s");
  });

  it("shows the reason line on the first row", () => {
    expect(teamMarkup()).toContain(
      "In-area team chosen — 40 s slower than the nearest (within 60 s)",
    );
  });

  it("shows team code, type and area chips", () => {
    const markup = teamMarkup();
    expect(markup).toContain("K01 008");
    expect(markup).toContain("P2");
    expect(markup).toContain("In area");
    expect(markup).toContain("Outside area");
  });

  it("badges only the team whose status is assumed", () => {
    const markup = teamMarkup();
    expect(markup.split("status unknown — assumed free in scenario")).toHaveLength(2);
  });

  it("lists excluded teams with their reasons", () => {
    const markup = teamMarkup();
    expect(markup).toContain("<details");
    expect(markup).toContain("Excluded teams (2)");
    expect(markup).toContain("off shift (07:00–19:00)");
    expect(markup).toContain("marked busy");
  });

  it("shows the roster badge", () => {
    expect(teamMarkup()).toContain("Official PRM plan · update 2 · from 1 Sep 2026 · 23 teams");
  });

  it("shows the no-eligible state with counts", () => {
    const markup = teamMarkup({ ranking: NO_ELIGIBLE_RANK });
    expect(markup).toContain("No eligible ambulance team at 21:00. 1 off shift, 1 marked busy.");
    expect(markup).not.toContain('type="radio"');
    expect(markup).toContain("Excluded teams (2)");
  });
});

it("preserves station identity, availability and drive/walk totals for narrow-panel data", () => {
  const markup = render({ ranking: TEAM_RANK_WITH_WALK });
  expect(markup).toContain("ul. Generała Bolesława Wieniawy-Długoszowskiego 15, Kraków");
  expect(markup).toContain("K01 008");
  expect(markup).toContain("07m 22s");
  expect(markup).toContain("03m 20s drive + 04m 02s on foot · 340 m");
  expect(markup).toContain("status unknown — assumed free in scenario");
  expect(markup).toContain("Recommended");
  expect(markup).toContain("Fastest");
});
