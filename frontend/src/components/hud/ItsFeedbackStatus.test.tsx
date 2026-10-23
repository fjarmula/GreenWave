import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import { ItsFeedbackStatus } from "./ItsFeedbackStatus";
import type { ItsRequestSnapshot } from "@/types/telemetry";
it("separates request status and controller report", () => {
  const request: ItsRequestSnapshot = {
    message_id: "MSG-ITS-1",
    intersections_group: ["I"],
    status: "REQUESTED",
    submitted_at_simulated_sec: 3,
    acknowledged_at_simulated_sec: null,
    last_updated_at_simulated_sec: 3,
    last_feedback_sequence: 0,
    reason: null,
  };
  const pending = renderToStaticMarkup(
    <ItsFeedbackStatus request={request} state="NORMAL" observedAt={3} ended={false} />,
  );
  expect(pending).toContain("Priority requested");
  expect(pending).toContain("NORMAL");
  expect(pending).not.toContain("Priority green");
  const accepted = renderToStaticMarkup(
    <ItsFeedbackStatus
      request={{
        ...request,
        status: "ACCEPTED",
        acknowledged_at_simulated_sec: 4,
        last_feedback_sequence: 1,
      }}
      state="CLEARING"
      observedAt={4}
      ended={true}
    />,
  );
  expect(accepted).toContain("Priority accepted");
  expect(accepted).toContain("Last simulated controller report");
  expect(accepted).toContain("CLEARING");
  expect(renderToStaticMarkup(<ItsFeedbackStatus observedAt={null} ended={false} />)).toContain(
    "ITS feedback unavailable",
  );
});
