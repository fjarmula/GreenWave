import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HomeMenu } from "@/components/workspace/HomeMenu";
import { SimulationProvider } from "@/components/simulation-provider";
import { corridor } from "@/lib/home-corridor";

const html = () =>
  renderToStaticMarkup(
    <SimulationProvider>
      <HomeMenu />
    </SimulationProvider>,
  );

it("lays the home page over the corridor background with a readable scrim", () => {
  const markup = html();
  expect(markup).toContain('class="home-backdrop"');
  expect(markup).toContain("home-scrim");
  expect(markup).not.toContain("corridor-art");
});

it("names the real corridor and keeps the simulation disclaimer", () => {
  const markup = html();
  expect(markup).toContain("home-corridor-caption");
  expect(markup).toContain("Aleje Trzech Wieszczów");
  // The corridor mixes junction and mid-block signals: count them as traffic signals.
  expect(markup).toContain(`${corridor.signals.length} traffic signals`);
  expect(markup).not.toContain("signalised junctions");
  expect(markup).toContain("Simulation only.");
});

it("credits the map data", () => {
  expect(html()).toContain('href="https://www.openstreetmap.org/copyright"');
});
