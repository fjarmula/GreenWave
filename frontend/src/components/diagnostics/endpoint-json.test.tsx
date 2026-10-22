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
