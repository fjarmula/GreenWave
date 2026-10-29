import type { ItsRequestSnapshot, SimulationStartResponse } from "@/types/telemetry";

type FailedStatus = "REJECTED" | "TIMED_OUT" | "EXPIRED";

/** One failed priority request: its outcome and the junctions now crossed by standard rules. */
export type FallbackNotice = {
  messageId: string;
  title: string;
  targets: string;
  targetIds: string[];
};

const TITLES: Record<FailedStatus, string> = {
  REJECTED: "Priority rejected",
  TIMED_OUT: "No controller response · 8 s timeout",
  EXPIRED: "Priority hold expired",
};

export const FALLBACK_DETAIL =
  "These junctions are crossed with ordinary signals (standard fallback). The run continues and other junctions keep requesting priority.";

function isFailed(status: ItsRequestSnapshot["status"]): status is FailedStatus {
  return Object.hasOwn(TITLES, status);
}

/**
 * Warnings for failed requests, oldest first. Derived from the request snapshots every tick
 * carries, so a reconnecting client shows them again; a failure never ends the run.
 */
export function fallbackNotices(
  requests: readonly ItsRequestSnapshot[],
  route: Pick<SimulationStartResponse, "route_intersections"> | null,
): FallbackNotice[] {
  const names = new Map(
    (route?.route_intersections ?? []).map((item) => [item.id, item.name ?? item.id]),
  );
  return requests.flatMap((request) =>
    isFailed(request.status)
      ? [
          {
            messageId: request.message_id,
            title: TITLES[request.status],
            targets: request.intersections_group.map((id) => names.get(id) ?? id).join(", "),
            targetIds: request.intersections_group,
          },
        ]
      : [],
  );
}
