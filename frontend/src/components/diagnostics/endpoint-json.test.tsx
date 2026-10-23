import { JsonViewer } from "./JsonDetails";

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EndpointActivity } from "./EndpointActivity";
import type { DiagnosticEntry } from "@/lib/diagnostics/store";
it("offers JSON inspection only for captured payloads", () => {
  const html = renderToStaticMarkup(
    <EndpointActivity
      entries={[
        {
          operation: "start",
          transport: "backend",
          outcome: "success",
          capture: {
            method: "POST",
            path: "/api/v1/simulation/start",
            requestBody: '{"x":1}',
            responseBody: '{"ok":true}',
          },
        } as DiagnosticEntry,
        { operation: "sse", transport: "backend", outcome: "open" },
      ]}
    />,
  );
  expect(html).toContain("View JSON");
  expect(html.match(/aria-label="View JSON for/g)).toHaveLength(1);
  expect(html).toContain("/api/v1/simulation/start");
});

it.each(["its", "its-feedback"] as const)(
  "labels %s receipt without claiming priority success",
  (operation) => {
    const eventType = operation === "its" ? "ITS_DISPATCH" : "ITS_FEEDBACK";
    const entry: DiagnosticEntry = {
      operation,
      transport: "backend",
      outcome: "success",
      tick: 14,
      capture: {
        method: "GET",
        path: "/api/v1/simulation/s/stream",
        eventType,
        validation: "accepted",
        responseBody: '{"status":"REJECTED"}',
      },
    };
    const html = renderToStaticMarkup(<EndpointActivity entries={[entry]} />);
    expect(html).toContain(`${eventType} received`);
    expect(html).not.toContain("success");
    expect(html).toContain("tick 14 (14 s simulated)");
  },
);

it("explains that payload validation is separate from controller approval", () => {
  const html = renderToStaticMarkup(
    <JsonViewer
      selection={{
        title: "Backend · ITS_DISPATCH received · tick 14",
        capture: {
          method: "GET",
          path: "/stream",
          eventType: "ITS_DISPATCH",
          validation: "accepted",
          responseBody: '{"event_type":"ITS_DISPATCH"}',
        },
      }}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Payload format valid");
  expect(html).not.toContain("Accepted by validation");
  expect(html).toContain("awaiting controller feedback");
});

it("does not describe an invalid dispatch payload as a submitted priority request", () => {
  const html = renderToStaticMarkup(
    <JsonViewer
      selection={{
        title: "Invalid event",
        capture: {
          method: "GET",
          path: "/stream",
          eventType: "ITS_DISPATCH",
          validation: "rejected",
          responseBody: "{}",
        },
      }}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Payload format invalid");
  expect(html).not.toContain("Priority request submitted");
});
