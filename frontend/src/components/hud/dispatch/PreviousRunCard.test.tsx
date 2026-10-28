import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it } from "vitest";

import { PreviousRunCard } from "@/components/hud/dispatch/PreviousRunCard";
import type { PreviousRun } from "@/lib/previous-run";

const RUN: PreviousRun = {
  greenWaveMode: "DISABLED",
  totalSeconds: 812,
  savedSeconds: -32,
  normalEstimateSeconds: 780,
  stationName: "5. Wojskowy Szpital Kliniczny",
  incidentLabel: "Rynek Główny 1",
  trafficDensity: 2,
};

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("PreviousRunCard", () => {
  it("is a labelled region headed as the previous simulated run", () => {
    const markup = renderToStaticMarkup(<PreviousRunCard run={RUN} />);

    expect(markup).toMatch(/<section[^>]*aria-labelledby="previous-run-heading"/);
    expect(markup).toMatch(/<h3 id="previous-run-heading"[^>]*>Previous simulated run<\/h3>/);
  });

  it("leads with the mode, then total travel time and saved vs normal", () => {
    const content = text(renderToStaticMarkup(<PreviousRunCard run={RUN} />));

    const mode = content.indexOf("ER Green Wave disabled");
    const total = content.indexOf("Total travel time 13m 32s");
    const saved = content.indexOf("Saved vs normal-traffic estimate −00m 32s");
    expect(mode).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(mode);
    expect(saved).toBeGreaterThan(total);
  });

  it("names the route and traffic density it ran with", () => {
    const content = text(renderToStaticMarkup(<PreviousRunCard run={RUN} />));

    expect(content).toContain("5. Wojskowy Szpital Kliniczny → Rynek Główny 1");
    expect(content).toContain("2.0x traffic");
  });

  it("shows an enabled run as enabled", () => {
    const content = text(
      renderToStaticMarkup(
        <PreviousRunCard run={{ ...RUN, greenWaveMode: "ENABLED", savedSeconds: 380 }} />,
      ),
    );

    expect(content).toContain("ER Green Wave enabled");
    expect(content).toContain("Saved vs normal-traffic estimate 06m 20s");
  });
});

describe("PreviousRunCard saved tone", () => {
  it.each([
    [-32, "text-caution"],
    [380, "text-go"],
  ])("colours %i s saved by its sign", (savedSeconds, colour) => {
    const markup = renderToStaticMarkup(<PreviousRunCard run={{ ...RUN, savedSeconds }} />);
    const saved = markup.match(/Saved vs normal-traffic estimate<\/dt><dd class="([^"]*)"/)!;

    expect(saved[1].split(" ")).toContain(colour);
  });
});
