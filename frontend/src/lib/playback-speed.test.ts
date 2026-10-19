import { expect, it } from "vitest";
import { PLAYBACK_SPEEDS } from "@/lib/playback-speed";

it("exports the D9 playback-speed options in selector order", () => {
  expect(PLAYBACK_SPEEDS).toEqual([1, 2, 5, 10]);
});
