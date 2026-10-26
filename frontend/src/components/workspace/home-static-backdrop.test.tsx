import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HomeStaticBackdrop } from "@/components/workspace/HomeStaticBackdrop";
import { corridor } from "@/lib/home-corridor";

it("draws the corridor over the masked road drawing, cropped for phones", () => {
  const html = renderToStaticMarkup(<HomeStaticBackdrop phone />);
  const [x, y, w, h] = corridor.phoneViewBox;
  // Shifted so the corridor runs along the right edge, clear of the stacked text.
  expect(html).toContain(`viewBox="${[x - w * 0.3, y, w, h].join(" ")}"`);
  expect(html).toContain('href="/home/krakow-roads.svg"');
  expect(html.match(/data-signal=/g)).toHaveLength(corridor.signals.length);
  expect(html).toContain('aria-hidden="true"');
});

it("uses the full frame on wide screens", () => {
  const html = renderToStaticMarkup(<HomeStaticBackdrop phone={false} />);
  expect(html).toContain(`viewBox="${corridor.viewBox.join(" ")}"`);
});
