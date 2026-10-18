import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DispatchForm } from "@/components/hud/DispatchForm";
import type { SimulationTransport } from "@/lib/config";

const transport = vi.hoisted(() => ({ current: "mock" as SimulationTransport }));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getFrontendConfig: () => ({
      ...actual.parseFrontendConfig({ transport: transport.current }, () => undefined),
    }),
  };
});

describe.each(["mock", "backend"] as const)("DispatchForm markup (%s transport)", (name) => {
  it("matches the recorded markup", async () => {
    transport.current = name;
    const markup = renderToStaticMarkup(
      <DispatchForm
        onInitialize={() => undefined}
        pending={false}
        errorMessage="Simulation backend unreachable"
        originId="prokocim"
        destinationId="nowa-huta"
        onOriginChange={() => undefined}
        onDestinationChange={() => undefined}
        onFocusNodes={() => undefined}
      />,
    );
    await expect(markup).toMatchFileSnapshot(`./__snapshots__/DispatchForm.${name}.html`);
  });
});
