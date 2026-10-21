import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { GreenWaveToggle } from "@/components/hud/dispatch/GreenWaveToggle";
import type { GreenWaveMode } from "@/types/telemetry";

type ButtonProps = { "aria-checked"?: boolean; onClick?: () => void; children?: ReactNode };

/** The radio buttons of a rendered (hook-free) control, found by walking its element tree. */
function radios(node: ReactNode): ReactElement<ButtonProps>[] {
  if (Array.isArray(node)) return node.flatMap(radios);
  if (!isValidElement<ButtonProps & { role?: string }>(node)) return [];
  const own = node.props.role === "radio" ? [node] : [];
  return [...own, ...radios(node.props.children)];
}

function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

describe("GreenWaveToggle", () => {
  it.each(["ENABLED", "DISABLED"] as const)("marks %s as the checked mode", (mode) => {
    const markup = renderToStaticMarkup(<GreenWaveToggle mode={mode} onChange={() => undefined} />);

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="ER Green Wave"');
    expect(markup).toMatch(
      new RegExp(
        `role="radio" aria-checked="true"[^>]*>${mode === "ENABLED" ? "Enabled" : "Disabled"}`,
      ),
    );
    expect(markup).toMatch(/simulated/i);
  });

  it.each([
    ["Disabled", "DISABLED"],
    ["Enabled", "ENABLED"],
  ] as const)("choosing %s reports %s", (label, mode) => {
    const onChange = vi.fn<(mode: GreenWaveMode) => void>();
    const other: GreenWaveMode = mode === "ENABLED" ? "DISABLED" : "ENABLED";
    const tree = GreenWaveToggle({ mode: other, onChange });

    const button = radios(tree).find((radio) => textOf(radio.props.children) === label);
    button?.props.onClick?.();

    expect(onChange).toHaveBeenCalledExactlyOnceWith(mode);
  });
});

describe("CascadeToggle", () => {
  it("is inactive and says why while ER Green Wave is disabled", () => {
    const markup = renderToStaticMarkup(
      <CascadeToggle enabled onToggle={() => undefined} disabled />,
    );

    expect(markup).toMatch(/role="switch"[^>]*disabled=""/);
    expect(markup).toContain("Only applies when ER Green Wave is enabled");
  });

  it("stays operable while ER Green Wave is enabled", () => {
    const markup = renderToStaticMarkup(<CascadeToggle enabled onToggle={() => undefined} />);

    expect(markup).not.toMatch(/role="switch"[^>]*disabled=""/);
  });
});
