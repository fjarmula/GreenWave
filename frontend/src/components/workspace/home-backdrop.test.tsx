import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HomeBackdrop } from "@/components/workspace/HomeBackdrop";

it("renders the static drawing on the server, never the map", () => {
  const html = renderToStaticMarkup(<HomeBackdrop />);
  expect(html).toContain('data-kind="static"');
  expect(html).toContain('href="/home/krakow-roads.svg"');
  expect(html).not.toContain("maplibregl");
});
