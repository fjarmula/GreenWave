import { expect, it } from "vitest";
import { backdropKind } from "@/lib/home-backdrop";

it.each([
  [{ hydrated: false, phone: false, webgl: true, failed: false }, "static"],
  [{ hydrated: true, phone: true, webgl: true, failed: false }, "static"],
  [{ hydrated: true, phone: false, webgl: false, failed: false }, "static"],
  [{ hydrated: true, phone: false, webgl: true, failed: true }, "static"],
  [{ hydrated: true, phone: false, webgl: true, failed: false }, "live"],
] as const)("%o → %s", (input, kind) => {
  expect(backdropKind(input)).toBe(kind);
});
