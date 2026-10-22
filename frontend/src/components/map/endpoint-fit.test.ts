import { describe, expect, it } from "vitest";

import { endpointFitDecision, type ViewBounds } from "@/components/map/endpoint-fit";

const VIEW: ViewBounds = { west: 19.9, south: 50.0, east: 20.0, north: 50.1 };
const INSIDE: [number, number] = [19.95, 50.05];
const OTHER_INSIDE: [number, number] = [19.92, 50.08];
const OUTSIDE: [number, number] = [20.2, 50.05];

describe("endpointFitDecision", () => {
  it("leaves the camera alone when every endpoint is already in view", () => {
    expect(
      endpointFitDecision({
        points: [INSIDE, OTHER_INSIDE],
        viewBounds: VIEW,
        focusRequested: false,
      }),
    ).toBe("none");
  });

  it("fits when an endpoint is outside the view", () => {
    expect(
      endpointFitDecision({ points: [INSIDE, OUTSIDE], viewBounds: VIEW, focusRequested: false }),
    ).toBe("fit");
  });

  it("fits on an explicit focus request even when everything is in view", () => {
    expect(
      endpointFitDecision({
        points: [INSIDE, OTHER_INSIDE],
        viewBounds: VIEW,
        focusRequested: true,
      }),
    ).toBe("fit");
  });

  it("has nothing to fit without endpoints", () => {
    expect(endpointFitDecision({ points: [], viewBounds: VIEW, focusRequested: true })).toBe(
      "none",
    );
  });

  it("counts a point exactly on the bound as inside", () => {
    expect(
      endpointFitDecision({
        points: [
          [20.0, 50.1],
          [19.9, 50.0],
        ],
        viewBounds: VIEW,
        focusRequested: false,
      }),
    ).toBe("none");
  });
});
