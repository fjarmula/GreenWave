import { describe, expect, it } from "vitest";
import { fallbackNotices } from "./priority-fallback";
import type { ItsRequestSnapshot } from "@/types/telemetry";

const snapshot = (
  message_id: string,
  status: ItsRequestSnapshot["status"],
  intersections_group: string[],
): ItsRequestSnapshot => ({
  message_id,
  status,
  intersections_group,
  submitted_at_simulated_sec: 1,
  last_updated_at_simulated_sec: 2,
  last_feedback_sequence: status === "REQUESTED" ? 0 : 1,
  acknowledged_at_simulated_sec: null,
  reason: null,
});

describe("fallbackNotices", () => {
  it("lists only failed requests, naming their targets", () => {
    const route = {
      route_intersections: [
        { id: "INT-1", name: "Mock junction A" },
        { id: "INT-2", name: null },
      ],
    } as Parameters<typeof fallbackNotices>[1];
    expect(
      fallbackNotices(
        [
          snapshot("MSG-ITS-1", "REJECTED", ["INT-1", "INT-2"]),
          snapshot("MSG-ITS-2", "ACCEPTED", ["INT-3"]),
          snapshot("MSG-ITS-3", "TIMED_OUT", ["INT-4"]),
          snapshot("MSG-ITS-4", "EXPIRED", ["INT-5"]),
          snapshot("MSG-ITS-5", "RELEASED", ["INT-6"]),
          snapshot("MSG-ITS-6", "REQUESTED", ["INT-7"]),
        ],
        route,
      ),
    ).toEqual([
      {
        messageId: "MSG-ITS-1",
        title: "Priority rejected",
        targets: "Mock junction A, INT-2",
        targetIds: ["INT-1", "INT-2"],
      },
      {
        messageId: "MSG-ITS-3",
        title: "No controller response · 8 s timeout",
        targets: "INT-4",
        targetIds: ["INT-4"],
      },
      {
        messageId: "MSG-ITS-4",
        title: "Priority hold expired",
        targets: "INT-5",
        targetIds: ["INT-5"],
      },
    ]);
  });

  it("is empty without failures", () => {
    expect(fallbackNotices([snapshot("MSG-ITS-1", "ACCEPTED", ["INT-1"])], null)).toEqual([]);
  });
});
