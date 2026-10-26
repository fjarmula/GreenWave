import { expect, it, vi } from "vitest";
import { metadata as layout } from "./layout";
import { metadata as compare } from "./compare/page";
import { metadata as diagnostics } from "./diagnostics/page";
import { metadata as driver } from "./driver/page";
import { metadata as greenWave } from "./simulation/green-wave/page";
import { metadata as standard } from "./simulation/standard/page";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

it("names each workspace in the browser title", () => {
  expect(layout.title).toEqual({ default: "ER-GreenWave", template: "%s · ER-GreenWave" });
  expect(compare.title).toBe("Comparison");
  expect(diagnostics.title).toBe("Diagnostics");
  expect(driver.title).toBe("Driver");
  expect(greenWave.title).toBe("Green Wave");
  expect(standard.title).toBe("Standard traffic");
});
