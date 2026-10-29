import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it } from "vitest";
import { ItsScenarioControl, nextItsScenario } from "./ItsScenarioControl";
import { itsScenarioCaption, itsScenarioTone } from "@/lib/driver-presentation";

const radios = (html: string) => html.match(/<button[^>]*role="radio"[^>]*>.*?<\/button>/g) ?? [];

describe("ItsScenarioControl", () => {
  it("renders five labelled radio cards", () => {
    const html = renderToStaticMarkup(
      <ItsScenarioControl value="NOMINAL" disabled={false} onChange={() => {}} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Simulated ITS feedback"');
    expect(radios(html)).toHaveLength(5);
    for (const label of ["Nominal", "Delayed", "Rejected", "No feedback", "Mixed", "accept · 1 s"])
      expect(html).toContain(label);
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="number"');
  });

  it("asks for the outcome seed only for the mixed scenario", () => {
    const html = renderToStaticMarkup(
      <ItsScenarioControl value="MIXED" seed={42} disabled={false} onChange={() => {}} />,
    );
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="0"[^>]*max="4294967295"/);
    expect(html).toContain('value="42"');
    expect(html).toContain("Outcome seed");
  });

  it("checks the current value with roving tabindex", () => {
    const html = renderToStaticMarkup(
      <ItsScenarioControl value="REJECTED" disabled={false} onChange={() => {}} />,
    );
    expect(radios(html)).toHaveLength(5);
    for (const radio of radios(html)) {
      const rejected = radio.includes("Rejected");
      expect(radio).toContain(`aria-checked="${rejected}"`);
      expect(radio).toContain(`tabindex="${rejected ? 0 : -1}"`);
    }
  });

  it("locks to Nominal with a reason when disabled", () => {
    const html = renderToStaticMarkup(
      <ItsScenarioControl value="REJECTED" disabled onChange={() => {}} />,
    );
    for (const radio of radios(html)) {
      expect(radio).toContain(`aria-checked="${radio.includes("Nominal")}"`);
      expect(radio).toContain('disabled=""');
    }
    expect(html).toContain("Green Wave off");
  });
});

describe("nextItsScenario", () => {
  it.each([
    ["NO_FEEDBACK", "ArrowRight", "MIXED"],
    ["MIXED", "ArrowDown", "NOMINAL"],
    ["NOMINAL", "ArrowLeft", "MIXED"],
    ["MIXED", "ArrowUp", "NO_FEEDBACK"],
    ["DELAYED", "ArrowRight", "REJECTED"],
    ["DELAYED", "Enter", null],
  ] as const)("%s + %s → %s", (current, key, next) => {
    expect(nextItsScenario(current, key)).toBe(next);
  });
});

describe("ITS scenario presentation", () => {
  it("captions and tones each scenario", () => {
    expect(itsScenarioCaption("NOMINAL")).toBe("accept · 1 s");
    expect(itsScenarioCaption("DELAYED")).toBe("accept · 5 s");
    expect(itsScenarioCaption("REJECTED")).toBe("reject · 1 s");
    expect(itsScenarioCaption("NO_FEEDBACK")).toBe("timeout · 8 s");
    expect(itsScenarioTone("NOMINAL")).toBe("tone-go");
    expect(itsScenarioTone("DELAYED")).toBe("tone-caution");
    expect(itsScenarioTone("REJECTED")).toBe("tone-emergency");
    expect(itsScenarioTone("NO_FEEDBACK")).toBe("tone-muted");
  });
});
