"use client";
import { useTranslation } from "@/components/language-provider";
import type { IntersectionState, ItsRequestSnapshot } from "@/types/telemetry";
const labels = {
  REQUESTED: "Priority requested · awaiting decision",
  ACCEPTED: "Priority accepted",
  RELEASED: "Priority released",
  REJECTED: "Priority rejected · standard fallback",
  TIMED_OUT: "Priority acknowledgement timed out · standard fallback",
  EXPIRED: "Priority hold expired · standard fallback",
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
  const { t } = useTranslation();
  if (observedAt == null)
    return <p className="mt-2 text-xs text-muted-foreground">{t("ITS feedback unavailable")}</p>;
  return (
    <div className="mt-2 space-y-1 text-2xs text-muted-foreground">
      <p>
        {t(request ? labels[request.status] : "No priority request")}
        {t(" ·")}
        {t(" ")}
        {t(ended ? "Last simulated controller report" : "Simulated controller reports")}
        {t(" ")}
        {t(state ?? "unavailable")}
        {t(" at ")}
        {t(observedAt)}
        {t(" s")}
      </p>
      {request && (
        <p className="break-words font-mono">
          {t(request.message_id)}
          {t(" · ")}
          {t(request.intersections_group.join(", "))}
          {t(" · submitted")}
          {t(" ")}
          {t(request.submitted_at_simulated_sec)}
          {t(" s · acknowledged")}
          {t(" ")}
          {t(
            request.acknowledged_at_simulated_sec == null
              ? "pending"
              : `${request.acknowledged_at_simulated_sec} s`,
          )}
        </p>
      )}
    </div>
  );
}
