import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  nextAvailability,
  TeamAvailabilityPanel,
} from "@/components/hud/dispatch/TeamAvailabilityPanel";
import { RESOURCES } from "@/lib/transport/__fixtures__/team-dispatch";

type ToggleProps = { "data-team-code"?: string; disabled?: boolean; onClick?: () => void };

/** The availability toggles of the rendered (hook-free) panel, walking its element tree. */
function toggles(node: ReactNode): ReactElement<ToggleProps>[] {
  if (Array.isArray(node)) return node.flatMap(toggles);
  if (!isValidElement<ToggleProps & { children?: ReactNode }>(node)) return [];
  const own = node.props["data-team-code"] ? [node] : [];
  return [...own, ...toggles(node.props.children)];
}

const panel = (availability: Record<string, "free" | "busy"> = {}) =>
  TeamAvailabilityPanel({ resources: RESOURCES, availability, onChange: vi.fn() });

describe("TeamAvailabilityPanel", () => {
  it("cycles unknown → free → busy → unknown", () => {
    expect(nextAvailability("unknown")).toBe("free");
    expect(nextAvailability("free")).toBe("busy");
    expect(nextAvailability("busy")).toBe("unknown");
  });

  it("calls the setter with the next state of the clicked team", () => {
    const onChange = vi.fn();
    const tree = TeamAvailabilityPanel({
      resources: RESOURCES,
      availability: { "K01 128": "free", "K01 001": "busy" },
      onChange,
    });
    const byCode = Object.fromEntries(toggles(tree).map((t) => [t.props["data-team-code"], t]));

    byCode["K01 008"].props.onClick?.();
    byCode["K01 128"].props.onClick?.();
    byCode["K01 001"].props.onClick?.();

    expect(onChange.mock.calls).toEqual([
      ["K01 008", "free"],
      ["K01 128", "busy"],
      ["K01 001", "unknown"],
    ]);
  });

  it("renders an off-shift team disabled with its hours", () => {
    const offShift = toggles(panel()).find((t) => t.props["data-team-code"] === "K01 176");
    expect(offShift?.props.disabled).toBe(true);

    const markup = renderToStaticMarkup(panel());
    expect(markup).toContain("off shift");
    expect(markup).toContain("07:00–19:00");
    expect(markup).toContain("24 h");
  });

  it("groups teams by base with type chips and simulated labels", () => {
    const markup = renderToStaticMarkup(panel({ "K01 001": "busy" }));

    expect(markup.indexOf("ul. Rynek Podgórski 2")).toBeLessThan(markup.indexOf("K01 008"));
    expect(markup.indexOf("ul. św. Łazarza 14")).toBeLessThan(markup.indexOf("K01 001"));
    expect(markup).toContain("P3");
    expect(markup).toContain("Busy");
    expect(markup).toContain("Unknown");
    expect(markup).toMatch(/simulated/i);
  });

  it("renders nothing without a roster", () => {
    expect(TeamAvailabilityPanel({ resources: null, availability: {}, onChange: vi.fn() })).toBe(
      null,
    );
  });
});
