import { expect, it } from "vitest";
import { formatMinutesSeconds } from "@/lib/format-duration";

it.each([
  [0, "00m 00s"],
  [65, "01m 05s"],
  [600, "10m 00s"],
])("formatMinutesSeconds(%i) is %s", (seconds, expected) => {
  expect(formatMinutesSeconds(seconds)).toBe(expected);
});
