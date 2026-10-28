import { expect, it, vi } from "vitest";
import { localizeMapControls } from "./control-localization";
it("updates map control tooltips and accessible labels in both languages", () => {
  const button = { title: "", setAttribute: vi.fn() };
  const root = { querySelector: () => button };
  localizeMapControls(root, "pl");
  expect(button.setAttribute).toHaveBeenCalledWith("aria-label", "Powiększ");
  expect(button.setAttribute).toHaveBeenCalledWith("aria-label", "Pomniejsz");
  expect(button.setAttribute).toHaveBeenCalledWith("aria-label", "Pokaż źródła mapy");
  localizeMapControls(root, "en");
  expect(button.setAttribute).toHaveBeenCalledWith("aria-label", "Zoom in");
});
