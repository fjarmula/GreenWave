import { expect, it } from "vitest";
import { destinations, routeForMode, viewRunPolicy } from "@/lib/workspace-routes";
it("provides distinct useful destinations and mode-correct return links", () => {
  expect(new Set(destinations.map((d) => d.href)).size).toBe(7);
  expect(destinations[0].href).toBe("/");
  expect(routeForMode("ENABLED")).toBe("/simulation/green-wave");
  expect(routeForMode("DISABLED")).toBe("/simulation/standard");
});
it("opposite-mode navigation shows setup and requires explicit replacement", () => {
  expect(viewRunPolicy("DISABLED", "ENABLED", "RUNNING")).toEqual({
    showRun: false,
    requiresReplacement: true,
  });
  expect(viewRunPolicy("ENABLED", "ENABLED", "RUNNING")).toEqual({
    showRun: true,
    requiresReplacement: false,
  });
  expect(viewRunPolicy("ENABLED", null, "SETUP")).toEqual({
    showRun: false,
    requiresReplacement: false,
  });
  expect(viewRunPolicy("ENABLED", "DISABLED", "STARTING").requiresReplacement).toBe(true);
});
