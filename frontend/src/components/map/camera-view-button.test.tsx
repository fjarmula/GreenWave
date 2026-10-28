import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it, vi } from "vitest";
import { CameraViewButton } from "./CameraViewButton";

it.each([
  { following: false, canFollow: true, label: "Follow vehicle", action: "follow" },
  { following: true, canFollow: true, label: "Show route", action: "route" },
  { following: false, canFollow: false, label: "Show route", action: "route" },
])(
  "offers $label for following=$following and canFollow=$canFollow",
  ({ following, canFollow, label, action }) => {
    const onFollow = vi.fn();
    const onShowRoute = vi.fn();
    const button = CameraViewButton({ following, canFollow, onFollow, onShowRoute });
    const html = renderToStaticMarkup(button);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(label);
    expect(html).not.toContain("disabled");
    button.props.onClick();
    expect(action === "follow" ? onFollow : onShowRoute).toHaveBeenCalledOnce();
    expect(action === "follow" ? onShowRoute : onFollow).not.toHaveBeenCalled();
  },
);

// These tests inspect callback props by calling controls directly, outside React rendering.
vi.mock("@/components/language-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/language-provider")>();
  return { ...actual, useTranslation: () => ({ language: "en", t: <T,>(value: T) => value }) };
});
