import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GreenWaveMark, WAVE_PATH } from "@/components/workspace/GreenWaveMark";

it("draws one decorative sine wave on the brand tile", () => {
  const html = renderToStaticMarkup(<GreenWaveMark />);
  expect(html).toContain('viewBox="0 0 32 32"');
  expect(html).toContain('aria-hidden="true"');
  expect(html.match(/<path/g)).toHaveLength(1);
});

it("keeps the favicon on the same wave", () => {
  const icon = readFileSync(join(__dirname, "../../app/icon.svg"), "utf8");
  expect(icon).toContain(`d="${WAVE_PATH}"`);
});
