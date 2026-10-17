import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { components } from "@/types/api.generated";
import type * as Telemetry from "@/types/telemetry";

type Schemas = components["schemas"];
// Compile-time identity check: `npm run typecheck` fails if an alias drifts from the contract.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type AliasChecks = [
  Expect<Equal<Telemetry.Position, Schemas["Position"]>>,
  Expect<Equal<Telemetry.RouteGeometry, Schemas["RouteGeometry"]>>,
  Expect<Equal<Telemetry.SimulationStartRequest, Schemas["SimulationStartRequest"]>>,
  Expect<Equal<Telemetry.SimulationStartResponse, Schemas["SimulationStartResponse"]>>,
  Expect<Equal<Telemetry.RouteIntersection, Schemas["RouteIntersection"]>>,
  Expect<Equal<Telemetry.SnappedEndpoint, Schemas["SnappedEndpoint"]>>,
  Expect<Equal<Telemetry.IntersectionState, Schemas["IntersectionState"]>>,
  Expect<Equal<Telemetry.IntersectionTelemetry, Schemas["IntersectionTelemetry"]>>,
  Expect<Equal<Telemetry.AmbulanceStatus, Schemas["AmbulanceStatus"]>>,
  Expect<Equal<Telemetry.AmbulanceTelemetry, Schemas["AmbulanceTelemetry"]>>,
  Expect<Equal<Telemetry.KpiMetrics, Schemas["KpiMetrics"]>>,
  Expect<Equal<Telemetry.SimulationTickEvent, Schemas["SimulationTickEvent"]>>,
  Expect<Equal<Telemetry.ItsDispatchEvent, Schemas["ItsDispatchEvent"]>>,
  Expect<Equal<Telemetry.SimulationCompletedEvent, Schemas["SimulationCompletedEvent"]>>,
  Expect<Equal<Telemetry.SimulationCancelledEvent, Schemas["SimulationCancelledEvent"]>>,
  Expect<Equal<Telemetry.SimulationStreamEvent, Schemas["SimulationStreamEvent"]>>,
  Expect<Equal<Telemetry.CancelReason, Schemas["CancelReason"]>>,
  Expect<Equal<Telemetry.ErrorCode, Schemas["ErrorCode"]>>,
  Expect<Equal<Telemetry.ErrorResponse, Schemas["ErrorResponse"]>>,
  Expect<Equal<Telemetry.StopResponse, Schemas["StopResponse"]>>,
];

describe("telemetry contract aliases", () => {
  it("declares no wire shape of its own", () => {
    const source = readFileSync(path.join(import.meta.dirname, "telemetry.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|^import .*$/gm, "");
    expect(code).not.toMatch(/\binterface\b/);
    expect(code).not.toContain("{");
    // No hand-written literal unions such as `= "NORMAL" | ...`.
    expect(code).not.toMatch(/=\s*["'|]/);
  });
});
