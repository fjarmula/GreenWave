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

it("retains captured request and response text and coalesces to the latest immutable tick", () => {
  const s = createDiagnosticStore();
  const capture = {
    method: "POST",
    path: "/api/v1/simulation/start",
    requestBody: '{"x":1}',
    responseBody: '{ "ok":true }',
  };
  s.record({ operation: "start", transport: "backend", outcome: "success", capture } as Parameters<
    typeof s.record
  >[0]);
  capture.responseBody = "changed";
  expect(s.getSnapshot()[0]).toMatchObject({
    capture: { responseBody: '{ "ok":true }', requestBody: '{"x":1}' },
  });
  s.record({
    operation: "sse",
    transport: "backend",
    outcome: "tick",
    tick: 1,
    capture: { method: "GET", path: "/stream", responseBody: '{"tick":1}' },
  } as Parameters<typeof s.record>[0]);
  const selected = s.getSnapshot().at(-1);
  s.record({
    operation: "sse",
    transport: "backend",
    outcome: "tick",
    tick: 2,
    capture: { method: "GET", path: "/stream", responseBody: '{"tick":2}' },
  } as Parameters<typeof s.record>[0]);
  expect(s.getSnapshot().at(-1)).toMatchObject({
    count: 2,
    capture: { responseBody: '{"tick":2}' },
  });
  expect(selected).toMatchObject({ capture: { responseBody: '{"tick":1}' } });
});

it("omits oversized UTF-8 bodies and bounds the retained payload bytes", async () => {
  const { CAPTURE_BODY_LIMIT, CAPTURE_HISTORY_LIMIT } = await import("./store");
  const store = createDiagnosticStore();
  store.record({
    operation: "start",
    transport: "backend",
    outcome: "success",
    capture: {
      method: "POST",
      path: "/start",
      responseBody: "ą".repeat(CAPTURE_BODY_LIMIT / 2 + 1),
    },
  });
  expect(store.getSnapshot()[0].capture).toMatchObject({ responseOmitted: true });
  expect(store.getSnapshot()[0].capture?.responseBody).toBeUndefined();
  for (let i = 0; i < 8; i++)
    store.record({
      operation: "start",
      transport: "backend",
      outcome: "success",
      capture: { method: "POST", path: "/start", responseBody: "x".repeat(CAPTURE_BODY_LIMIT) },
    });
  const retained = store
    .getSnapshot()
    .reduce(
      (sum, e) => sum + new TextEncoder().encode(e.capture?.responseBody ?? "").byteLength,
      0,
    );
  expect(retained).toBeLessThanOrEqual(CAPTURE_HISTORY_LIMIT);
  expect(store.getSnapshot().length).toBeLessThan(8);
  store.clear();
  expect(store.getSnapshot()).toEqual([]);
});
