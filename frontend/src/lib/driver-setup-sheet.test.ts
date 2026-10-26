import { expect, it } from "vitest";
import { setupSheetMinimizable } from "@/lib/driver-setup-sheet";

it("minimizes only the driver's incident setup card", () => {
  expect(setupSheetMinimizable({ driver: true, setup: true, onSite: false })).toBe(true);
  // The on-site answer has no peek row: minimizing would leave "Back to setup" inert.
  expect(setupSheetMinimizable({ driver: true, setup: true, onSite: true })).toBe(false);
  expect(setupSheetMinimizable({ driver: true, setup: false, onSite: false })).toBe(false);
  expect(setupSheetMinimizable({ driver: false, setup: true, onSite: false })).toBe(false);
});
