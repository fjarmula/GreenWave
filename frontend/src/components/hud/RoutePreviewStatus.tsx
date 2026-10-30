"use client";

import { useTranslation } from "@/components/language-provider";
import { pageCandidate, plannedRoute, type TimeMode } from "@/lib/station-choice";
import type { IncidentDispatchState } from "@/lib/useIncidentDispatch";

export function RoutePreviewStatus({
  dispatch,
  mode,
}: {
  dispatch: Pick<
    IncidentDispatchState,
    "rankStatus" | "rankError" | "ranking" | "selectedStationId"
  >;
  mode: TimeMode;
}) {
  const { t } = useTranslation();
  if (dispatch.rankStatus === "idle") return null;
  const candidate = pageCandidate(dispatch, mode);
  const message =
    dispatch.rankStatus === "loading"
      ? "Planning route…"
      : dispatch.rankStatus === "error"
        ? (dispatch.rankError ?? "Route preview unavailable")
        : !candidate
          ? "No eligible unit for this incident"
          : candidate.on_site
            ? "On site · no vehicle route"
            : plannedRoute(dispatch, mode)
              ? "Planned route"
              : "Route preview unavailable";
  return (
    <p
      role="status"
      className="route-preview-status surface-glass rounded-xl px-3 py-2 text-xs text-muted-foreground"
    >
      {t(message)}
    </p>
  );
}
