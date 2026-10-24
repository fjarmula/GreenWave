import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { RaceBar } from "@/components/comparison/RaceBar";

it("marks the race card as a map overlay, so route fits keep clear of it", () => {
  const markup = renderToStaticMarkup(
    <RaceBar
      standing={{
        leader: "LEVEL",
        leadM: 0,
        arrived: null,
        positions: { ENABLED: 0, DISABLED: 0 },
        bothArrived: false,
      }}
      running
      stopping={false}
      onStop={() => {}}
      tickMilliseconds={1000}
    />,
  );
  expect(markup).toMatch(/<section class="race-bar[^"]*"[^>]*data-map-occluder/);
});
