import { Footprints, Settings2 } from "lucide-react";

import { formatSignalDistance } from "@/lib/driver-presentation";
import { formatMinutesSeconds } from "@/lib/format-duration";
import type { OnFootLeg, Station } from "@/types/telemetry";

/** The answer to an incident at the station: the crew walks; no simulation runs (ADR 0012). */
export function OnSiteResult({
  station,
  walk,
  onBackToSetup,
}: {
  station: Station;
  walk: OnFootLeg;
  onBackToSetup: () => void;
}) {
  const duration = formatMinutesSeconds(Math.round(walk.seconds));
  const distance = formatSignalDistance(walk.distance_m);
  return (
    <section role="status" className="hud-panel hud-enter tone-go">
      <div className="flex items-start gap-3">
        <span className="hud-icon">
          <Footprints aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="hud-title">Incident at {station.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {`No drive needed. On foot about ${duration} (${distance}) · simulated estimate.`}
          </p>
        </div>
      </div>
      <button type="button" onClick={onBackToSetup} className="hud-secondary pressable mt-4">
        <Settings2 aria-hidden />
        Back to setup
      </button>
    </section>
  );
}
