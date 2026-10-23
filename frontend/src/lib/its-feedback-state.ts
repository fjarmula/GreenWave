import type { ItsFeedbackEvent, ItsRequestSnapshot } from "@/types/telemetry";

/** Invalid identities or transitions must not consume the run's feedback sequence. */
export function applyItsFeedback(
  requests: ItsRequestSnapshot[],
  event: ItsFeedbackEvent,
  lastSequence: number,
): ItsRequestSnapshot[] | null {
  const prior = requests.find((r) => r.message_id === event.request_message_id);
  if (
    !prior ||
    event.feedback_sequence <= lastSequence ||
    event.feedback_sequence <= prior.last_feedback_sequence ||
    event.observed_at_simulated_sec < prior.last_updated_at_simulated_sec ||
    JSON.stringify(prior.intersections_group) !== JSON.stringify(event.intersections_group)
  )
    return null;
  const allowed =
    prior.status === "REQUESTED"
      ? ["ACCEPTED", "REJECTED", "TIMED_OUT", "RELEASED"]
      : prior.status === "ACCEPTED"
        ? ["RELEASED", "EXPIRED"]
        : [];
  if (!allowed.includes(event.status)) return null;
  return requests.map((r) =>
    r === prior
      ? {
          ...r,
          status: event.status,
          reason: event.reason,
          last_feedback_sequence: event.feedback_sequence,
          last_updated_at_simulated_sec: event.observed_at_simulated_sec,
          acknowledged_at_simulated_sec:
            event.status === "ACCEPTED"
              ? event.observed_at_simulated_sec
              : r.acknowledged_at_simulated_sec,
        }
      : r,
  );
}
