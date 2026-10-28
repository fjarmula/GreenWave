import { describe, expect, it } from "vitest";

import { warsawMinute } from "@/lib/local-time";

const utc = (iso: string) => new Date(iso);

describe("warsawMinute", () => {
  it("formats the Kraków wall-clock minute whatever the machine's zone", () => {
    expect(warsawMinute(utc("2026-10-27T20:03:30Z"))).toBe("2026-10-27T21:03");
  });

  it("rounds down to the given step", () => {
    expect(warsawMinute(utc("2026-10-27T20:03:30Z"), 5)).toBe("2026-10-27T21:00");
  });

  it("crosses midnight into the Kraków date", () => {
    expect(warsawMinute(utc("2026-10-27T23:30:00Z"))).toBe("2026-10-28T00:30");
  });

  it.each([
    ["2026-10-25T00:30:00Z", "2026-10-25T02:30"], // first 02:30 (CEST)
    ["2026-10-25T01:30:00Z", "2026-10-25T02:30"], // repeated 02:30 (CET)
    ["2026-03-29T01:30:00Z", "2026-03-29T03:30"], // 02:xx does not exist
  ])("handles the DST change at %s", (instant, expected) => {
    expect(warsawMinute(utc(instant))).toBe(expected);
  });
});
