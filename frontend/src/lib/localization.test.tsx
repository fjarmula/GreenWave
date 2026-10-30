import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider, useTranslation } from "@/components/language-provider";
import { resolveLanguage, translate } from "@/lib/localization";
function Example() {
  const { t } = useTranslation();
  return <p>{t("Simulation running")}</p>;
}
describe("localization", () => {
  it("defaults missing and unsupported preferences to Polish", () => {
    expect(resolveLanguage(null)).toBe("pl");
    expect(resolveLanguage("de")).toBe("pl");
    expect(resolveLanguage("en")).toBe("en");
  });
  it("renders Polish by default and English when selected", () => {
    expect(
      renderToStaticMarkup(
        <LanguageProvider>
          <Example />
        </LanguageProvider>,
      ),
    ).toContain("Symulacja trwa");
    expect(
      renderToStaticMarkup(
        <LanguageProvider initialLanguage="en">
          <Example />
        </LanguageProvider>,
      ),
    ).toContain("Simulation running");
  });
  it("translates interpolated messages while preserving identifiers and raw JSON", () => {
    expect(translate("Simulation backend unreachable at http://localhost:8000", "pl")).toBe(
      "Serwer symulacji jest niedostępny pod adresem http://localhost:8000",
    );
    expect(translate("INT-0360", "pl")).toBe("INT-0360");
    expect(translate('{"state":"NORMAL"}', "pl")).toBe('{"state":"NORMAL"}');
  });
  it("keeps English copy and Polish place names intact", () => {
    expect(translate("Home", "en")).toBe("Home");
    expect(translate("Aleje Trzech Wieszczów", "pl")).toBe("Aleje Trzech Wieszczów");
  });
});

it("preserves adjacent text spacing and localizes compound labels and decimals", () => {
  expect(translate(" Vehicle ", "pl")).toBe(" Pojazd ");
  expect(translate("Green Wave · Simulation running", "pl")).toBe("GreenWave · Symulacja trwa");
  expect(translate("1.5 km", "pl")).toBe("1,5 km");
  expect(translate("1 Sep 2026", "pl")).toBe("1 wrz 2026");
});

it("translates empty optional suffixes and complete signal states", () => {
  expect(
    translate("Simulated runs from the selected station, without and with ER Green Wave.", "pl"),
  ).toContain("Symulowane przejazdy");
  expect(translate("Simulated signal INT-0360: NORMAL", "pl")).toBe(
    "Symulowana sygnalizacja INT-0360: ZWYKŁY PROGRAM",
  );
  expect(
    translate("Simulated signal INT-0360: NORMAL; simulated phase detail unavailable", "pl"),
  ).toContain("ZWYKŁY PROGRAM; szczegóły");
});

it("preserves GreenWave as a proper noun throughout the Polish catalog", async () => {
  const { polish } = await import("./polish");
  for (const [english, translated] of Object.entries(polish)) {
    if (/green\s?wave/i.test(english)) expect(translated, english).toContain("GreenWave");
  }
  expect(Object.values(polish).join(" ")).not.toMatch(/zielon\w* fal/iu);
});

it.each([
  ["finished", "Zakończona"],
  ["cancelled", "Anulowana"],
  ["running", "W trakcie"],
  ["starting", "Uruchamianie"],
  ["setup", "Konfiguracja"],
])("uses a standalone Polish label for %s", (status, label) => {
  expect(translate(status, "pl")).toBe(label);
});

it("preserves every interpolation parameter in the Polish catalog", async () => {
  const { polish } = await import("./polish");
  for (const [english, translated] of Object.entries(polish)) {
    const slots = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
    expect(slots(translated), english).toEqual(slots(english));
  }
});
