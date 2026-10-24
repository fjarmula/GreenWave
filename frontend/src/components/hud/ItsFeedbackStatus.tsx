import type { IntersectionState, ItsRequestSnapshot } from "@/types/telemetry";
const labels = {
  REQUESTED: "Priority requested · awaiting decision",
  ACCEPTED: "Priority accepted",
  RELEASED: "Priority released",
  REJECTED: "Priority rejected",
  TIMED_OUT: "Priority acknowledgement timed out",
  EXPIRED: "Priority hold expired",
};
export function ItsFeedbackStatus({
  request,
  state,
  observedAt,
  ended,
}: {
  request?: ItsRequestSnapshot;
  state?: IntersectionState;
  observedAt: number | null | undefined;
  ended: boolean;
}) {
  if (observedAt == null)
    return <p className="mt-2 text-xs text-muted-foreground">ITS feedback unavailable</p>;
  return (
    <div className="mt-2 space-y-1 text-2xs text-muted-foreground">
      <p>
        {request ? labels[request.status] : "No priority request"} ·{" "}
        {ended ? "Last simulated controller report" : "Simulated controller reports"}{" "}
        {state ?? "unavailable"} at {observedAt} s
      </p>
      {request && (
        <p className="break-words font-mono">
          {request.message_id} · {request.intersections_group.join(", ")} · submitted{" "}
          {request.submitted_at_simulated_sec} s · acknowledged{" "}
          {request.acknowledged_at_simulated_sec == null
            ? "pending"
            : `${request.acknowledged_at_simulated_sec} s`}
        </p>
      )}
    </div>
  );
}
