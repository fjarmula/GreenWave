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
      new RegExp(
        `href="/docs"[^>]*>[\\s\\S]*?${language === "pl" ? "Dokumentacja" : "Documentation"}`,
      ),
    );
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

it.each([
  [null, "Symulacja anulowana"],
  ["STOPPED", "Symulacja zatrzymana"],
] as const)(
  "renders the return action and status as complete Polish labels (%s)",
  async (cancelReason, status) => {
    const { initialSimulationState } = await import("@/lib/simulation-state");
    const { request } = await import("@/lib/comparison/fixtures.test-support");
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <SimulationProvider
          initialState={{
            ...initialSimulationState,
            simulationState: "CANCELLED",
            cancelReason,
            startRequest: request,
          }}
        >
          <HomeMenu />
        </SimulationProvider>
      </LanguageProvider>,
    );
    expect(html).toContain("Wróć do symulacji");
    expect(html).toContain(status);
    expect(html).not.toContain("anulowanej");
    expect(html).toContain(">GreenWave<");
  },
);

it("shows a localized rejection delay and explains simulated ITS timing", async () => {
  const { ItsScenarioControl } = await import("./hud/dispatch/ItsScenarioControl");
  const html = renderToStaticMarkup(
    <LanguageProvider initialLanguage="pl">
      <ItsScenarioControl value="REJECTED" disabled={false} onChange={() => {}} />
    </LanguageProvider>,
  );
  expect(html).toContain("odrzucenie · 1 s");
  expect(html).not.toContain("decline");
  expect(html).toContain("Czasy liczone są od wysłania żądania priorytetu w sekundach symulacji.");
});
