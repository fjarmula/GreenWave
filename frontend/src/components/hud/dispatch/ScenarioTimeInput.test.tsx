import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "@/test-utils/render";
import { describe, expect, it, vi } from "vitest";

import { ScenarioTimeInput } from "@/components/hud/dispatch/ScenarioTimeInput";

type InputProps = { type?: string; onChange?: (event: { target: { value: string } }) => void };

function input(node: ReactNode): ReactElement<InputProps> | null {
  if (Array.isArray(node)) return node.map(input).find(Boolean) ?? null;
  if (!isValidElement<InputProps & { children?: ReactNode }>(node)) return null;
  if (node.type === "input") return node;
  return input(node.props.children);
}

describe("ScenarioTimeInput", () => {
  it("renders a labelled local date-time input with the value", () => {
    const markup = renderToStaticMarkup(
      <ScenarioTimeInput value="2026-10-27T21:00" onChange={() => undefined} />,
    );

    expect(markup).toContain('type="datetime-local"');
    expect(markup).toContain('value="2026-10-27T21:00"');
    expect(markup).toContain("Scenario time");
    expect(markup).toMatch(/simulated/i);
  });

  it("reports a new time and ignores a cleared field", () => {
    const onChange = vi.fn();
    const element = input(ScenarioTimeInput({ value: "2026-10-27T21:00", onChange }));

    element?.props.onChange?.({ target: { value: "2026-10-27T10:00" } });
    element?.props.onChange?.({ target: { value: "" } });

    expect(onChange.mock.calls).toEqual([["2026-10-27T10:00"]]);
  });
});

// These tests inspect callback props by calling controls directly, outside React rendering.
vi.mock("@/components/language-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/language-provider")>();
  return { ...actual, useTranslation: () => ({ language: "en", t: <T,>(value: T) => value }) };
});
