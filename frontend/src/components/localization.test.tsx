import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./language-provider";
import { LanguageSwitch } from "./workspace/LanguageSwitch";
import { HomeMenu } from "./workspace/HomeMenu";
import { SimulationProvider } from "./simulation-provider";
import { GreenWaveToggle } from "./hud/dispatch/GreenWaveToggle";
import RouteError from "@/app/error";

vi.mock("./workspace/HomeBackdrop", () => ({ HomeBackdrop: () => null }));

describe("localized interactions", () => {
  it.each(["pl", "en"] as const)("renders the home screen and switch in %s", (language) => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <SimulationProvider>
          <HomeMenu />
        </SimulationProvider>
      </LanguageProvider>,
    );
    expect(html).toContain(
      language === "pl" ? "Szybsza droga na miejsce zdarzenia." : "A clearer path to the incident.",
    );
    expect(html).toContain(language === "pl" ? "Wyłącznie symulacja." : "Simulation only.");
    expect(html).toContain("Aleje Trzech Wieszczów");
    expect(html).toMatch(
      language === "pl"
        ? /aria-label="Polski" aria-pressed="true"/
        : /aria-label="English" aria-pressed="true"/,
    );
  });
  it("defaults both controls and recoverable errors to Polish", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <LanguageSwitch />
        <GreenWaveToggle mode="DISABLED" onChange={() => undefined} />
        <RouteError error={new Error()} reset={() => undefined} />
      </LanguageProvider>,
    );
    expect(html).toContain("Wyłączone");
    expect(html).toContain("Coś poszło nie tak");
    expect(html).toContain("Spróbuj ponownie");
  });
});
