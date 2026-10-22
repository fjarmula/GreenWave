import { expect, it } from "vitest";
import { createDiagnosticStore } from "./store";
it("bounds history, coalesces ticks and discards fields outside the allowlist", () => {
  const s = createDiagnosticStore();
  for (let i = 0; i < 201; i++)
    s.record({
      operation: "start",
      transport: "backend",
      outcome: "success",
      tick: i,
      address: "SECRET ADDRESS",
      body: "SECRET BODY",
      coordinates: [50, 19],
    } as Parameters<typeof s.record>[0]);
  expect(s.getSnapshot()).toHaveLength(200);
  expect(s.getSnapshot()[0].tick).toBe(1);
  expect(JSON.stringify(s.getSnapshot())).not.toContain("SECRET");
  s.record({ operation: "sse", transport: "mock", outcome: "tick", tick: 1 });
  s.record({ operation: "sse", transport: "mock", outcome: "tick", tick: 2 });
  expect(s.getSnapshot().at(-1)).toMatchObject({ tick: 2, count: 2 });
  s.record({ operation: "sse", transport: "mock", outcome: "failure" });
  expect(s.getSnapshot().at(-1)?.outcome).toBe("failure");
});
