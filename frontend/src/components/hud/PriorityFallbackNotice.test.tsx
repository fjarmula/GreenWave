import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "@/components/language-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";
import { PriorityFallbackNotice } from "./PriorityFallbackNotice";
import type { ItsRequestSnapshot, SimulationStartResponse } from "@/types/telemetry";

const rejected: ItsRequestSnapshot = {
  message_id: "MSG-ITS-1",
  intersections_group: ["INT-9001"],
  status: "REJECTED",
  submitted_at_simulated_sec: 3,
  acknowledged_at_simulated_sec: null,
  last_updated_at_simulated_sec: 4,
  last_feedback_sequence: 1,
  reason: "CONTROLLER_REJECTED",
};

function render(state: Partial<SimulationState>, language: "pl" | "en", compact = false) {
  const route = {
    green_wave_mode: "ENABLED",
    route_intersections: [{ id: "INT-9001", name: "Mock junction A" }],
  } as SimulationStartResponse;
  return renderToStaticMarkup(
    <LanguageProvider initialLanguage={language}>
      <SimulationProvider
        initialState={{
          ...initialSimulationState,
          simulationState: "RUNNING",
          routeData: route,
          ...state,
        }}
      >
        <PriorityFallbackNotice compact={compact} />
      </SimulationProvider>
    </LanguageProvider>,
  );
}

describe("PriorityFallbackNotice", () => {
  it("warns without ending the run, in English and Polish", () => {
    const en = render({ itsRequests: [rejected] }, "en");
    expect(en).toContain('role="status"');
    expect(en).toContain("Priority unavailable · run continues");
    expect(en).toContain("Priority rejected");
    expect(en).toContain("Mock junction A");
    const pl = render({ itsRequests: [rejected] }, "pl");
    expect(pl).toContain("Priorytet niedostępny · przejazd trwa dalej");
    expect(pl).toContain("Priorytet odrzucony");
    expect(render({ itsRequests: [rejected] }, "pl", true)).toContain(
      "Tryb awaryjny · 1 skrzyżowanie",
    );
  });

  it("stays hidden without failures or once the run has ended", () => {
    expect(render({ itsRequests: [] }, "en")).toBe("");
    expect(render({ itsRequests: [rejected], simulationState: "FINISHED" }, "en")).toBe("");
  });
});
