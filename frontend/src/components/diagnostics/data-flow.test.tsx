import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it } from "vitest";
import { DataFlowView } from "./DataFlowView";
it("separates architecture from unobserved endpoints and synthetic activity", () => {
  const html = renderToStaticMarkup(
    <DataFlowView
      entries={[{ operation: "start", transport: "mock", outcome: "success", count: 1 }]}
    />,
  );
  for (const text of [
    "Stations",
    "Geocode",
    "Ranking",
    "Start",
    "SSE",
    "Validation",
    "Map",
    "Stop",
    "Dataset quality",
    "in-process simulated",
    "Not observed",
    "Synthetic",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("server latency");
});
it("explains temporary payload retention for JSON inspection", () => {
  const html = renderToStaticMarkup(<DataFlowView entries={[]} />);
  expect(html).toContain("JSON inspection");
  expect(html).not.toContain("No addresses, coordinates, bodies or raw errors are retained");
});

it("distinguishes event receipt and explains the simulated tick clock", () => {
  const html = renderToStaticMarkup(
    <DataFlowView
      entries={[{ operation: "its", transport: "backend", outcome: "success", tick: 14 }]}
    />,
  );
  expect(html).toContain("event received");
  expect(html).not.toContain("success");
  expect(html).toContain("tick 14 (14 s simulated)");
  expect(html).toContain("Several events may share a step");
});
