import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EndpointActivity } from "./EndpointActivity";
import { JsonViewer } from "./JsonDetails";
import type { DiagnosticCapture, DiagnosticEntry } from "@/lib/diagnostics/store";
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

it("shows only the response body, with no request/response switch", () => {
  const capture: DiagnosticCapture = {
    method: "POST",
    path: "/api/v1/simulation/start",
    requestBody: '{"x":1}',
    responseBody: '{"y":2}',
  };
  const html = renderToStaticMarkup(
    <JsonViewer selection={{ capture, title: "Start" }} onClose={() => {}} />,
  );
  expect(html).toContain("&quot;y&quot;: 2");
  expect(html).not.toContain('aria-label="Payload direction"');
  expect(html).not.toContain("Request body");
  expect(html).toContain("Copy response");
  const event = renderToStaticMarkup(
    <JsonViewer
      selection={{ capture: { ...capture, eventType: "tick" }, title: "Tick" }}
      onClose={() => {}}
    />,
  );
  expect(event).toContain("Copy event");
});
