import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { DashboardLayout } from "@/components/dashboard";

type Step = { type: unknown; key: string | null; index: number };

/** Types, keys and child positions from the root to `target`: what React reconciles by. */
function pathTo(node: ReactNode, target: ReactElement, index = 0): Step[] | null {
  if (Array.isArray(node)) {
    for (const [childIndex, child] of node.entries()) {
      const found = pathTo(child, target, childIndex);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  const step = { type: node.type, key: node.key, index };
  if (node === target) return [step];
  const below = pathTo(node.props.children, target);
  return below && [step, ...below];
}

const preview = <div data-testid="route-preview" />;
const form = <form />;

describe("Dashboard map lifecycle", () => {
  it("keeps the route preview (and its map) at the same tree position in setup and live", () => {
    const setup = pathTo(DashboardLayout({ mode: "setup", form, preview }), preview);
    const live = pathTo(DashboardLayout({ mode: "live", form, preview }), preview);

    expect(setup).not.toBeNull();
    expect(live).toEqual(setup);
  });

  it("shows the dispatch form only in setup", () => {
    expect(pathTo(DashboardLayout({ mode: "setup", form, preview }), form)).not.toBeNull();
    expect(pathTo(DashboardLayout({ mode: "live", form, preview }), form)).toBeNull();
  });
});
