import { expect, it } from "vitest";
import { nextCameraMode } from "@/lib/camera-policy";
it("uses hysteresis and preserves manual suspension", () => {
  expect(nextCameraMode("overview", { type: "zoom", zoom: 16.5, user: true })).toBe("overview");
  expect(nextCameraMode("overview", { type: "zoom", zoom: 16.6, user: true })).toBe("following");
  expect(nextCameraMode("following", { type: "zoom", zoom: 16, user: true })).toBe("following");
  expect(nextCameraMode("following", { type: "zoom", zoom: 15.9, user: true })).toBe("overview");
  expect(nextCameraMode("following", { type: "pan", user: false })).toBe("following");
  expect(nextCameraMode("following", { type: "pan", user: true })).toBe("suspended");
  expect(nextCameraMode("suspended", { type: "zoom", zoom: 17, user: false })).toBe("suspended");
  expect(nextCameraMode("suspended", { type: "resume" })).toBe("following");
  expect(nextCameraMode("following", { type: "show-route" })).toBe("overview");
  expect(nextCameraMode("suspended", { type: "run" })).toBe("overview");
});
it("a pan at overview does not prevent the next overview-to-detail crossing", () => {
  expect(nextCameraMode("overview", { type: "pan", user: true })).toBe("overview");
});
