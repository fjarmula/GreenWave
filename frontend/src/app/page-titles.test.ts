import { expect, it, vi } from "vitest";
import { metadata as layout } from "./layout";
import { generateMetadata as compare } from "./compare/page";
import { generateMetadata as diagnostics } from "./diagnostics/page";
import { generateMetadata as driver } from "./driver/page";
import { generateMetadata as greenWave } from "./simulation/green-wave/page";
import { generateMetadata as standard } from "./simulation/standard/page";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

it("names each workspace in the browser title", async () => {
  expect(layout.title).toEqual({ default: "ER-GreenWave", template: "%s · ER-GreenWave" });
  expect((await compare()).title).toBe("Porównanie");
  expect((await diagnostics()).title).toBe("Diagnostyka");
  expect((await driver()).title).toBe("Kierowca");
  expect((await greenWave()).title).toBe("GreenWave");
  expect((await standard()).title).toBe("Ruch standardowy");
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
