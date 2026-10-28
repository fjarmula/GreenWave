import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import RouteError from "./error";

function button(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) return node.map(button).find(Boolean) ?? null;
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return null;
  if (node.type === "button") return node as ReactElement<{ onClick: () => void }>;
  return button(node.props.children);
}

it("shows a recoverable error page instead of a blank screen", () => {
  const reset = vi.fn();
  const page = RouteError({ error: new Error("WebGL"), reset });

  expect(renderToStaticMarkup(page)).toContain("Something went wrong");
  button(page)?.props.onClick();
  expect(reset).toHaveBeenCalledOnce();
});
