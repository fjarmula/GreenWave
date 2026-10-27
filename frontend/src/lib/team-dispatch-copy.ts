/**
 * Copy for resource-aware ambulance dispatch (ADR 0014). Availability is simulated: an unset
 * team is "assumed free", never presented as a live status.
 */
import type { AreaRuleOutcome, ExcludedTeam, PrmTeam, RosterInfo } from "@/types/telemetry";

/** Approved D4 margin; the backend applies it, the copy only names it. */
export const AREA_PREFERENCE_MARGIN_S = 60;
export const ASSUMED_FREE_BADGE = "status unknown — assumed free in scenario";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "24 h" or "07:00–19:00". */
export function hoursText(team: Pick<PrmTeam, "ready_from_min" | "ready_to_min">): string {
  if (team.ready_from_min === 0 && team.ready_to_min === 1440) return "24 h";
  return `${clock(team.ready_from_min)}–${clock(team.ready_to_min)}`;
}

/** The reason line of the recommended team. */
export function selectionReasonText(rule: AreaRuleOutcome): string {
  const seconds = Math.round(Math.abs(rule.delta_seconds ?? 0));
  switch (rule.reason) {
    case "IN_AREA_WITHIN_MARGIN":
      return `In-area team chosen — ${seconds} s slower than the nearest (within ${AREA_PREFERENCE_MARGIN_S} s)`;
    case "NEAREST_OUTSIDE_MARGIN":
      return `Nearest team is outside the incident area — ${seconds} s faster than the in-area team`;
    case "NEAREST":
      return "Nearest eligible team";
  }
}

/** Why a team is not dispatched: "off shift (07:00–19:00)" or "marked busy". */
export function exclusionText(team: PrmTeam | undefined, reason: ExcludedTeam["reason"]): string {
  if (reason === "BUSY_OVERRIDE") return "marked busy";
  return team ? `off shift (${hoursText(team)})` : "off shift";
}

export function noEligibleText(time: string, offShift: number, busy: number): string {
  return `No eligible ambulance team at ${time}. ${offShift} off shift, ${busy} marked busy.`;
}

/** "Official PRM plan · update 2 · from 1 Sep 2026 · 23 teams". */
export function rosterBadgeText(roster: RosterInfo): string {
  const [year, month, day] = roster.effective_from.split("-").map(Number);
  const from = `${day} ${MONTHS[month - 1]} ${year}`;
  return `Official PRM plan · update ${roster.plan_update} · from ${from} · ${roster.teams_in_scope} teams`;
}

/** "2026-10-27T21:05:00" -> "21:05". */
export function scenarioClock(scenarioTime: string): string {
  return scenarioTime.slice(11, 16);
}
