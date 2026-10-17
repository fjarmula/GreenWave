import type { IntersectionTelemetry } from "@/types/telemetry";

/**
 * The purple cascade visual marks a cascade-triggered CLEARING only; once the
 * signal moves on (PRIORITY_GREEN, RECOVERY) it uses that state's colour even
 * if the backend still reports `is_cascade`. Shared by the HUD list and map.
 */
export function isCascadeClearing({
  state,
  is_cascade: isCascade,
}: Pick<IntersectionTelemetry, "state" | "is_cascade">): boolean {
  return state === "CLEARING" && isCascade;
}
