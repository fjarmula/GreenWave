import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "@/test-utils/render";
import { RoutePreviewStatus } from "./RoutePreviewStatus";
import { TEAM_RANK } from "@/lib/transport/__fixtures__/team-dispatch";

const ready = {
  rankStatus: "ready" as const,
  rankError: null,
  ranking: TEAM_RANK,
  selectedStationId: null,
};
describe("route preview feedback", () => {
  it("announces planning, failure and missing geometry without a simulation", () => {
    expect(
      renderToStaticMarkup(
        <RoutePreviewStatus dispatch={{ ...ready, rankStatus: "loading" }} mode="BOTH" />,
      ),
    ).toContain("Planning route…");
    expect(
      renderToStaticMarkup(
        <RoutePreviewStatus
          dispatch={{
            ...ready,
            rankStatus: "error",
            rankError: "No station of this type can reach this location",
          }}
          mode="BOTH"
        />,
      ),
    ).toContain("No station of this type can reach this location");
    expect(renderToStaticMarkup(<RoutePreviewStatus dispatch={ready} mode="BOTH" />)).toContain(
      "Route preview unavailable",
    );
    expect(
      renderToStaticMarkup(
        <RoutePreviewStatus
          dispatch={{ ...ready, ranking: { ...TEAM_RANK, candidates: [] } }}
          mode="BOTH"
        />,
      ),
    ).toContain("No eligible unit for this incident");
  });
  it("shows a planning label for geometry and no driven preview for an on-site crew", () => {
    const ranking = {
      ...TEAM_RANK,
      candidates: [
        {
          ...TEAM_RANK.candidates[0],
          route_geometry: {
            type: "LineString" as const,
            coordinates: [
              [19.9, 50],
              [19.94, 50.06],
            ] as [number, number][],
          },
        },
      ],
    };
    expect(
      renderToStaticMarkup(<RoutePreviewStatus dispatch={{ ...ready, ranking }} mode="BOTH" />),
    ).toContain("Planned route");
    expect(
      renderToStaticMarkup(
        <RoutePreviewStatus
          dispatch={{
            ...ready,
            ranking: { ...ranking, candidates: [{ ...ranking.candidates[0], on_site: true }] },
          }}
          mode="BOTH"
        />,
      ),
    ).toContain("On site · no vehicle route");
    expect(
      renderToStaticMarkup(
        <RoutePreviewStatus dispatch={{ ...ready, rankStatus: "idle" }} mode="BOTH" />,
      ),
    ).toBe("");
  });
});
