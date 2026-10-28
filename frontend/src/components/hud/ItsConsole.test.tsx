import { renderToStaticMarkup } from "@/test-utils/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItsConsole } from "@/components/hud/ItsConsole";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));

function withEntries(count: number): SimulationState {
  return {
    ...initialSimulationState,
    simulationState: "RUNNING",
    itsLog: Array.from({ length: count }, (_, i) => ({
      messageId: `MSG-ITS-${i + 1}`,
      text: `dispatch ${i + 1}`,
    })),
  };
}

/** Each rendered log row: its number, text, and whether it is marked as the newest. */
function rows(markup: string) {
  return [...markup.matchAll(/<p([^>]*)><span[^>]*>(\d+)<\/span><span>([^<]*)<\/span><\/p>/g)].map(
    ([, attributes, number, text]) => ({
      number,
      text,
      newest: attributes.includes('aria-current="true"'),
    }),
  );
}

describe("ItsConsole", () => {
  beforeEach(() => {
    state = initialSimulationState;
  });

  it.each([1, 3, 7])("marks only the newest of %i entries", (count) => {
    state = withEntries(count);
    const shown = rows(renderToStaticMarkup(<ItsConsole />));

    expect(shown.filter((row) => row.newest).map((row) => row.text)).toEqual([`dispatch ${count}`]);
    expect(shown.at(-1)?.newest).toBe(true);
  });

  it("numbers rows by message sequence, not by position in the visible window", () => {
    state = withEntries(7);
    const shown = rows(renderToStaticMarkup(<ItsConsole />));

    expect(shown.map((row) => row.number)).toEqual(["03", "04", "05", "06", "07"]);
  });
});
