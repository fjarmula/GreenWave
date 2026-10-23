import { describe, expect, it } from "vitest";

import { resolveThemeChoice, themeThumbStyle } from "@/components/hud/ThemeToggle";

describe("ThemeToggle helpers", () => {
  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const)("resolves %s (prefers dark: %s) to %s", (choice, prefersDark, resolved) => {
    expect(resolveThemeChoice(choice, prefersDark)).toBe(resolved);
  });

  it("names the thumb so it morphs inside the theme view transition", () => {
    expect(themeThumbStyle(2)).toEqual({
      viewTransitionName: "theme-thumb",
      transform: "translateX(200%)",
    });
  });
});
