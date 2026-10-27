import { describe, expect, it } from "vitest";

import {
  ASSUMED_FREE_BADGE,
  exclusionText,
  hoursText,
  noEligibleText,
  rosterBadgeText,
  scenarioClock,
  selectionReasonText,
} from "@/lib/team-dispatch-copy";
import { prmTeam, ROSTER, TEAM_RANK } from "@/lib/transport/__fixtures__/team-dispatch";
import type { AreaRuleOutcome } from "@/types/telemetry";

const RULE = TEAM_RANK.area_rule as AreaRuleOutcome;

describe("selectionReasonText", () => {
  it("names the nearest eligible team", () => {
    expect(selectionReasonText({ ...RULE, reason: "NEAREST", delta_seconds: null })).toBe(
      "Nearest eligible team",
    );
  });

  it("explains an in-area team within the margin", () => {
    expect(selectionReasonText({ ...RULE, delta_seconds: 40.4 })).toBe(
      "In-area team chosen — 40 s slower than the nearest (within 60 s)",
    );
  });

  it("explains a faster team outside the incident area", () => {
    expect(
      selectionReasonText({ ...RULE, reason: "NEAREST_OUTSIDE_MARGIN", delta_seconds: 74.6 }),
    ).toBe("Nearest team is outside the incident area — 75 s faster than the in-area team");
  });
});

describe("exclusion and empty-state copy", () => {
  it("names the hours of an off-shift team", () => {
    const daytime = prmTeam("K01 176", { ready_from_min: 420, ready_to_min: 1140 });
    expect(exclusionText(daytime, "OFF_SHIFT")).toBe("off shift (07:00–19:00)");
  });

  it("falls back when the team is not listed", () => {
    expect(exclusionText(undefined, "OFF_SHIFT")).toBe("off shift");
  });

  it("says marked busy", () => {
    expect(exclusionText(prmTeam("K01 008"), "BUSY_OVERRIDE")).toBe("marked busy");
  });

  it("counts why no team is eligible", () => {
    expect(noEligibleText("21:00", 4, 19)).toBe(
      "No eligible ambulance team at 21:00. 4 off shift, 19 marked busy.",
    );
  });
});

describe("roster and hours", () => {
  it("formats the roster badge", () => {
    expect(rosterBadgeText(ROSTER)).toBe(
      "Official PRM plan · update 2 · from 1 Sep 2026 · 23 teams",
    );
  });

  it("formats 24 h and daytime windows", () => {
    expect(hoursText(prmTeam("K01 008"))).toBe("24 h");
    expect(hoursText(prmTeam("K01 176", { ready_from_min: 420, ready_to_min: 1140 }))).toBe(
      "07:00–19:00",
    );
  });

  it("badges an assumed-free team", () => {
    expect(ASSUMED_FREE_BADGE).toBe("status unknown — assumed free in scenario");
  });

  it("shows the clock of a scenario time", () => {
    expect(scenarioClock("2026-10-27T21:05:00")).toBe("21:05");
    expect(scenarioClock("2026-10-27T07:00")).toBe("07:00");
  });
});
